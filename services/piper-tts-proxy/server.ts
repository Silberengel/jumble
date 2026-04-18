interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
}

const PIPER_TTS_DEBUG = process.env.PIPER_TTS_DEBUG === '1';

function piperDebug(...args: unknown[]) {
  if (PIPER_TTS_DEBUG) console.log(...args);
}

const WYOMING_DOWN_COOLDOWN_MS = 60_000;
let lastWyomingDownLog = 0;

function isWyomingUnreachableMessage(msg: string): boolean {
  return /ECONNREFUSED|connection refused|ENOTFOUND|ETIMEDOUT/i.test(msg);
}

function logWyomingUnreachableThrottled(host: string, port: number, detail?: string) {
  const now = Date.now();
  if (now - lastWyomingDownLog < WYOMING_DOWN_COOLDOWN_MS) return;
  lastWyomingDownLog = now;
  console.warn(
    `[Piper TTS] Wyoming/Piper not reachable at ${host}:${port}${detail ? ` — ${detail}` : ''}. ` +
      `Start the Wyoming Piper service or set PIPER_TTS_HOST / PIPER_TTS_PORT. ` +
      `Suppressing similar messages for ${WYOMING_DOWN_COOLDOWN_MS / 1000}s. Use PIPER_TTS_DEBUG=1 for verbose logs.`
  );
}

/**
 * Proxy endpoint for Piper TTS using Wyoming protocol (TCP)
 * Wyoming protocol: JSON messages newline-delimited, then raw binary audio
 */
/** HTTP handler (plain `Request` / `Response`); bridged to Wyoming Piper over TCP. */
export async function handlePiperTtsPost(request: Request): Promise<Response> {
  piperDebug('Piper TTS API: Request received');
  try {
    const body: TTSRequest = await request.json();
    const { text, voice, speed } = body;

    piperDebug('Piper TTS API: Processing request', {
      textLength: text?.length,
      voice,
      speed,
      voiceType: typeof voice,
      voiceValue: voice
    });

    if (!text?.trim()) {
      console.error('Piper TTS API: Missing text field');
      return errorResponse(400, 'Missing required field: text');
    }

    // Filter and prepare text
    const filteredText = filterCryptographicContent(text);
    if (!filteredText.trim()) {
      console.warn('Piper TTS API: Text is empty after filtering');
      return errorResponse(400, 'Text contains only cryptographic addresses/IDs that cannot be read aloud');
    }
    
    const sentences = splitIntoSentences(filteredText);
    const fullText = sentences.filter(s => s.trim().length > 0).join(' ');
    piperDebug(`Piper TTS API: Processing ${sentences.length} sentences, total length: ${fullText.length}`);
    
    // Use provided voice, or auto-detect language and select voice if not provided
    let selectedVoice = voice;
    if (!selectedVoice || selectedVoice.trim() === '') {
      const detectedLang = detectLanguage(fullText);
      selectedVoice = getVoiceForLanguage(detectedLang);
      piperDebug(`Piper TTS API: No voice provided, auto-detected language: ${detectedLang}, selected voice: ${selectedVoice}`);
    } else {
      piperDebug(`Piper TTS API: Using provided voice: ${selectedVoice}`);
    }

    // Stream audio response with cancellation support
    const abortController = new AbortController();
    let wyomingCleanup: (() => void) | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        const tcpConfig = getTcpConfig();
        try {
          const audioChunks: Uint8Array[] = [];
          let audioFormat: { rate: number; width: number; channels: number } | null = null;
          let totalBytes = 0;

          piperDebug('Piper TTS API: Connecting to Wyoming server at', tcpConfig.hostname, 'port', tcpConfig.port);

          await synthesizeWithWyoming(
            tcpConfig,
            fullText,
            selectedVoice,
            speed,
            abortController.signal,
            (cleanup) => {
              wyomingCleanup = cleanup;
            },
            (chunk: Uint8Array, format?: { rate: number; width: number; channels: number }) => {
              if (abortController.signal.aborted) return;

              if (format && !audioFormat) {
                audioFormat = format;
                piperDebug('Piper TTS API: Received audio format:', format);
              }
              if (chunk.length > 0) {
                audioChunks.push(chunk);
                totalBytes += chunk.length;
              }
            }
          );

          if (abortController.signal.aborted) {
            piperDebug('Piper TTS API: Synthesis aborted');
            controller.close();
            return;
          }

          if (!audioFormat || totalBytes === 0) {
            throw new Error('No audio data received from Wyoming server');
          }

          piperDebug('Piper TTS API: Collected audio, total size:', totalBytes, 'bytes');

          const format = audioFormat as { rate: number; width: number; channels: number };
          const wavHeader = createWavHeader(format.rate, format.width, format.channels, totalBytes);
          controller.enqueue(wavHeader);
          
          for (const chunk of audioChunks) {
            if (abortController.signal.aborted) break;
            controller.enqueue(chunk);
          }
          
          controller.close();
        } catch (error) {
          if (abortController.signal.aborted) {
            piperDebug('Piper TTS API: Operation cancelled');
            controller.close();
          } else {
            const msg = error instanceof Error ? error.message : String(error);
            if (isWyomingUnreachableMessage(msg)) {
              logWyomingUnreachableThrottled(tcpConfig.hostname, tcpConfig.port, msg);
              if (PIPER_TTS_DEBUG) console.error('Piper TTS API: Streaming error:', error);
            } else {
              console.error('Piper TTS API: Streaming error:', error);
            }
            controller.error(error);
          }
        }
      },
      cancel() {
        piperDebug('Piper TTS API: Stream cancelled by client');
        abortController.abort();
        if (wyomingCleanup) {
          wyomingCleanup();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'audio/wav',
        'Transfer-Encoding': 'chunked',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Piper TTS API error:', message);
    return errorResponse(500, message);
  }
};

/**
 * Synthesize speech using Wyoming protocol
 * Protocol flow (standard):
 * 1. Send: {"type":"synthesize","data":{"text":"..."}}\n
 * 2. Receive format: {"rate":22050,"width":2,"channels":1}\n
 * 3. Receive raw binary audio (no delimiters)
 * 4. Optionally receive: {"type":"done"}\n or connection closes
 * 
 * Some implementations may send audio-chunk messages:
 * - {"type":"audio-chunk","payload_length":N}\n followed by N bytes of binary audio
 * - These may arrive before or after the format message
 * - We handle both standard and audio-chunk variants for compatibility
 */
async function synthesizeWithWyoming(
  config: { hostname: string; port: number },
  text: string,
  voice: string | undefined,
  speed: number | undefined,
  abortSignal: AbortSignal,
  onCleanup: (cleanup: () => void) => void,
  onChunk: (chunk: Uint8Array, format?: { rate: number; width: number; channels: number }) => void
): Promise<void> {
  const net = await import('net');
  
  return new Promise<void>((resolve, reject) => {
    let socket: import('net').Socket | null = null;
    let buffer = Buffer.alloc(0);
    let audioFormat: { rate: number; width: number; channels: number } | null = null;
    let hasReceivedAudio = false;
    let isResolved = false;
    let lastDataTime = Date.now();
    let completionTimer: NodeJS.Timeout | null = null;
    const preFormatAudioChunks: Uint8Array[] = []; // Buffer audio chunks received before format
    let hasProcessedAudioChunks = false; // Track if we've processed audio-chunk messages

    piperDebug('Wyoming: Creating TCP connection to', config.hostname, 'port', config.port);

    const cleanup = () => {
      if (socket && !socket.destroyed) {
        piperDebug('Wyoming: Cleaning up TCP connection');
        socket.destroy();
      }
    };

    // Register cleanup function
    onCleanup(cleanup);

    // Check if already aborted
    if (abortSignal.aborted) {
      piperDebug('Wyoming: Abort signal already set, not connecting');
      reject(new Error('Operation cancelled'));
      return;
    }

    // Listen for abort signal
    const abortHandler = () => {
      piperDebug('Wyoming: Abort signal received, cleaning up');
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      cleanup();
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        reject(new Error('Operation cancelled'));
      }
    };
    abortSignal.addEventListener('abort', abortHandler);

    const timeout = setTimeout(() => {
      cleanup();
      if (!isResolved) {
        isResolved = true;
        console.error('Wyoming: Timeout after 5 minutes');
        reject(new Error('Wyoming protocol timeout'));
      }
    }, 300000); // 5 minutes

    try {
      socket = net.createConnection(config.port, config.hostname, () => {
        piperDebug('Wyoming: TCP connected successfully');
        // Send synthesize request
        // Wyoming protocol expects voice as an object with 'name' property, not a plain string
        const message = {
          type: 'synthesize',
          data: {
            text,
            ...(voice ? { voice: { name: voice } } : {}),
            ...(speed !== undefined && speed !== 1.0 ? { speed } : {}),
          }
        };
        const messageStr = JSON.stringify(message) + '\n';
        piperDebug(
          'Wyoming: Sending synthesize message, text length:',
          text.length,
          'voice:',
          voice ? `{name: "${voice}"}` : 'none (will use default)'
        );
        piperDebug('Wyoming: Full message:', messageStr.trim());
        try {
          socket!.write(messageStr);
          piperDebug('Wyoming: Synthesize message sent');
        } catch (writeError) {
          console.error('Wyoming: Failed to write message:', writeError);
          cleanup();
          clearTimeout(timeout);
          if (!isResolved) {
            isResolved = true;
            reject(new Error(`Failed to send message: ${writeError instanceof Error ? writeError.message : String(writeError)}`));
          }
        }
      });
    } catch (error) {
      console.error('Wyoming: Failed to create connection:', error);
      cleanup();
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        reject(new Error(`Failed to create connection: ${error instanceof Error ? error.message : String(error)}`));
      }
      return;
    }

    socket.on('data', (data: Buffer) => {
      // Check if aborted
      if (abortSignal.aborted) {
        console.log('Wyoming: Aborted, ignoring data');
        return;
      }

      lastDataTime = Date.now();
      
      // Clear completion timer since we're receiving data
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }

      console.log('Wyoming: Received data, size:', data.length, 'bytes, audioFormat:', audioFormat ? 'received' : 'not received');
      buffer = Buffer.concat([buffer, data]);

      // Process buffer
      while (buffer.length > 0) {
        // Check if aborted during processing
        if (abortSignal.aborted) {
          console.log('Wyoming: Aborted during buffer processing');
          break;
        }

        // After format received, check for "done" message, audio-chunk messages, or process as raw audio
        if (audioFormat) {
          // Check if buffer starts with JSON (for done/error/audio-chunk messages)
          if (buffer.length > 0 && buffer[0] === 0x7b) { // '{' byte
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex !== -1) {
              try {
                const line = buffer.subarray(0, newlineIndex).toString('utf8').trim();
                const message = JSON.parse(line);
                
                if (message.type === 'done') {
                  console.log('Wyoming: Received done message');
                  if (completionTimer) {
                    clearTimeout(completionTimer);
                    completionTimer = null;
                  }
                  buffer = buffer.subarray(newlineIndex + 1);
                  cleanup();
                  clearTimeout(timeout);
                  if (!isResolved) {
                    isResolved = true;
                    resolve();
                  }
                  return;
                }
                
                if (message.type === 'error') {
                  console.error('Wyoming: Received error message:', message.message);
                  buffer = buffer.subarray(newlineIndex + 1);
                  cleanup();
                  clearTimeout(timeout);
                  if (!isResolved) {
                    isResolved = true;
                    reject(new Error(message.message || 'Wyoming protocol error'));
                  }
                  return;
                }
                
                if (message.type === 'audio-stop') {
                  console.log('Wyoming: Received audio-stop message');
                  buffer = buffer.subarray(newlineIndex + 1);
                  if (completionTimer) {
                    clearTimeout(completionTimer);
                    completionTimer = null;
                  }
                  cleanup();
                  clearTimeout(timeout);
                  if (!isResolved) {
                    isResolved = true;
                    resolve();
                  }
                  return;
                }
                
                // Handle audio-chunk messages after format
                if (message.type === 'audio-chunk' && typeof message.payload_length === 'number') {
                  const payloadLength = message.payload_length;
                  const messageEnd = newlineIndex + 1;
                  // If data_length is specified, there's additional JSON data before the payload
                  const dataLength = typeof message.data_length === 'number' ? message.data_length : 0;
                  const payloadStart = messageEnd + dataLength;
                  const payloadEnd = payloadStart + payloadLength;
                  
                  if (buffer.length >= payloadEnd) {
                    const audioPayload = new Uint8Array(buffer.subarray(payloadStart, payloadEnd));
                    onChunk(audioPayload);
                    hasReceivedAudio = true;
                    hasProcessedAudioChunks = true;
                    buffer = buffer.subarray(payloadEnd);
                    continue; // Continue processing loop
                  } else {
                    // Don't have full payload yet - wait for more data
                    break;
                  }
                }
              } catch (error) {
                // Not valid JSON - treat as raw audio
                // Fall through to raw audio processing
              }
            } else {
              // No newline yet - might be incomplete JSON, wait for more data
              break;
            }
          }
          
          // No JSON message found - process all buffer as raw audio
          if (buffer.length > 0) {
            onChunk(new Uint8Array(buffer));
            hasReceivedAudio = true;
            buffer = Buffer.alloc(0);
          }
          
          // If we've received audio and buffer is empty, set a completion timer
          // This handles cases where the server doesn't send "done" or close connection
          if (hasReceivedAudio && buffer.length === 0 && !completionTimer) {
            completionTimer = setTimeout(() => {
              if (!isResolved && hasReceivedAudio && !abortSignal.aborted) {
                console.log('Wyoming: No data received for 500ms after audio, assuming completion');
                cleanup();
                clearTimeout(timeout);
                isResolved = true;
                resolve();
              }
            }, 500); // 500ms timeout after last data
          }
          
          // Break and wait for more data (could be more audio or "done" message)
          break;
        }

        // Before format: scan buffer for JSON format message
        // Look for '{' followed by newline-delimited JSON
        let formatFound = false;
        let searchStart = 0;
        
        while (searchStart < buffer.length && !formatFound) {
          const braceIndex = buffer.indexOf(0x7b, searchStart); // '{' byte
          if (braceIndex === -1) {
            // No more '{' found - this is all binary data, buffer it
            break;
          }
          
          // Look for newline after this '{'
          const newlineIndex = buffer.indexOf('\n', braceIndex);
          if (newlineIndex === -1) {
            // No newline yet - wait for more data
            break;
          }
          
          // Try to parse as JSON
          const lineBytes = buffer.subarray(braceIndex, newlineIndex);
          const line = lineBytes.toString('utf8').trim();
          
          if (line.endsWith('}')) {
            try {
              const message = JSON.parse(line);
              console.log('Wyoming: Received message:', JSON.stringify(message));
              
              // Check for audio-start message (contains format info)
              if (message.type === 'audio-start' && (message.rate !== undefined || message.channels !== undefined)) {
                audioFormat = {
                  rate: message.rate,
                  width: message.width || 2,
                  channels: message.channels,
                };
                console.log('Wyoming: Audio format from audio-start:', audioFormat);
                
                // Send format notification
                onChunk(new Uint8Array(0), audioFormat);
                
                // Process any buffered audio chunks
                if (preFormatAudioChunks.length > 0) {
                  console.log('Wyoming: Processing', preFormatAudioChunks.length, 'buffered audio chunks after audio-start');
                  for (const chunk of preFormatAudioChunks) {
                    onChunk(chunk);
                    hasReceivedAudio = true;
                  }
                  preFormatAudioChunks.length = 0;
                  hasProcessedAudioChunks = true;
                }
                
                buffer = buffer.subarray(newlineIndex + 1);
                searchStart = 0;
                continue;
              }
              
              // Check for format message (can be a standalone format object or embedded in other messages)
              if (message.rate !== undefined || message.channels !== undefined) {
                audioFormat = {
                  rate: message.rate,
                  width: message.width || 2,
                  channels: message.channels,
                };
                console.log('Wyoming: Audio format:', audioFormat);
                
                // Remove everything up to and including the format message
                const dataAfterFormat = buffer.subarray(newlineIndex + 1);
                
                // Send format notification first
                onChunk(new Uint8Array(0), audioFormat);
                
                // Process any buffered audio chunks received before format
                if (preFormatAudioChunks.length > 0) {
                  console.log('Wyoming: Processing', preFormatAudioChunks.length, 'buffered audio chunks');
                  for (const chunk of preFormatAudioChunks) {
                    onChunk(chunk);
                    hasReceivedAudio = true;
                  }
                  preFormatAudioChunks.length = 0; // Clear the buffer
                  hasProcessedAudioChunks = true;
                }
                
                // Process any raw data before format as audio (protocol violation, but handle it)
                // BUT: Skip this if we've already processed audio-chunk messages, as that data
                // is likely protocol overhead or corrupted, not actual audio
                if (braceIndex > 0 && !hasProcessedAudioChunks) {
                  const preFormatData = buffer.subarray(0, braceIndex);
                  // Only process if it's not empty and looks like audio (not JSON)
                  // Also check that it's a reasonable size (not just a few bytes of protocol overhead)
                  if (preFormatData.length > 0 && preFormatData[0] !== 0x7b && preFormatData.length > 100) {
                    console.warn('Wyoming: Processing', braceIndex, 'bytes of raw data received before format message as audio');
                    onChunk(new Uint8Array(preFormatData));
                    hasReceivedAudio = true;
                  } else if (preFormatData.length > 0 && preFormatData.length <= 100) {
                    console.warn('Wyoming: Skipping', preFormatData.length, 'bytes of data before format (likely protocol overhead)');
                  }
                } else if (braceIndex > 0 && hasProcessedAudioChunks) {
                  console.warn('Wyoming: Skipping', braceIndex, 'bytes of data before format (audio-chunk messages already processed)');
                }
                
                // Process data after format as audio
                if (dataAfterFormat.length > 0) {
                  onChunk(new Uint8Array(dataAfterFormat));
                  hasReceivedAudio = true;
                }
                
                buffer = Buffer.alloc(0);
                formatFound = true;
                continue; // Continue processing loop
              }

              // Check for done/error messages
              if (message.type === 'done') {
                console.log('Wyoming: Received done message');
                buffer = buffer.subarray(newlineIndex + 1);
                cleanup();
                clearTimeout(timeout);
                if (!isResolved) {
                  isResolved = true;
                  if (hasReceivedAudio) {
                    resolve();
                  } else {
                    reject(new Error('No audio data received'));
                  }
                }
                return;
              }

              if (message.type === 'error') {
                console.error('Wyoming: Received error message:', message.message);
                buffer = buffer.subarray(newlineIndex + 1);
                cleanup();
                clearTimeout(timeout);
                if (!isResolved) {
                  isResolved = true;
                  reject(new Error(message.message || 'Wyoming protocol error'));
                }
                return;
              }
              
              // Handle audio-stop message
              if (message.type === 'audio-stop') {
                console.log('Wyoming: Received audio-stop message');
                buffer = buffer.subarray(newlineIndex + 1);
                
                // If we have buffered audio chunks but no format, use default format
                if (preFormatAudioChunks.length > 0 && !audioFormat) {
                  console.warn('Wyoming: Format message never received, using default format for', preFormatAudioChunks.length, 'buffered chunks');
                  // Default Piper TTS format: 22050 Hz, 16-bit (width=2), mono (channels=1)
                  audioFormat = {
                    rate: 22050,
                    width: 2,
                    channels: 1,
                  };
                  console.log('Wyoming: Using default audio format:', audioFormat);
                  
                  // Send format notification
                  onChunk(new Uint8Array(0), audioFormat);
                  
                  // Process buffered chunks
                  for (const chunk of preFormatAudioChunks) {
                    onChunk(chunk);
                    hasReceivedAudio = true;
                  }
                  preFormatAudioChunks.length = 0;
                  hasProcessedAudioChunks = true;
                }
                
                cleanup();
                clearTimeout(timeout);
                if (!isResolved) {
                  isResolved = true;
                  if (hasReceivedAudio) {
                    resolve();
                  } else {
                    reject(new Error('No audio data received'));
                  }
                }
                return;
              }
              
              // Handle audio-chunk messages
              if (message.type === 'audio-chunk' && typeof message.payload_length === 'number') {
                const payloadLength = message.payload_length;
                const messageEnd = newlineIndex + 1;
                // If data_length is specified, there's additional JSON data before the payload
                const dataLength = typeof message.data_length === 'number' ? message.data_length : 0;
                const payloadStart = messageEnd + dataLength;
                const payloadEnd = payloadStart + payloadLength;
                
                console.log('Wyoming: Processing audio-chunk, payload_length:', payloadLength, 'data_length:', dataLength, 'buffer length:', buffer.length, 'payloadStart:', payloadStart, 'payloadEnd:', payloadEnd);
                
                // Check if we have the full payload
                if (buffer.length >= payloadEnd) {
                  // If there's data_length, try to parse the format from that data
                  if (dataLength > 0 && !audioFormat) {
                    const dataBytes = buffer.subarray(messageEnd, payloadStart);
                    try {
                      const dataStr = dataBytes.toString('utf8');
                      const formatData = JSON.parse(dataStr);
                      if (formatData.rate !== undefined || formatData.channels !== undefined) {
                        audioFormat = {
                          rate: formatData.rate,
                          width: formatData.width || 2,
                          channels: formatData.channels,
                        };
                        console.log('Wyoming: Found format in data section:', audioFormat);
                        onChunk(new Uint8Array(0), audioFormat);
                      }
                    } catch (e) {
                      console.warn('Wyoming: Failed to parse data section as JSON:', e);
                    }
                  }
                  
                  // Extract the audio payload (after the data section)
                  const audioPayload = new Uint8Array(buffer.subarray(payloadStart, payloadEnd));
                  console.log('Wyoming: Extracted audio payload:', audioPayload.length, 'bytes, first 8 bytes:', Array.from(audioPayload.slice(0, 8)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
                  
                  // Check if format is embedded in the audio-chunk message itself
                  if (!audioFormat && (message.rate !== undefined || message.channels !== undefined)) {
                    audioFormat = {
                      rate: message.rate || 22050,
                      width: message.width || 2,
                      channels: message.channels || 1,
                    };
                    console.log('Wyoming: Found format in audio-chunk message:', audioFormat);
                    onChunk(new Uint8Array(0), audioFormat);
                  }
                  
                  // If we have format, process it as audio; otherwise buffer it
                  if (audioFormat) {
                    onChunk(audioPayload);
                    hasReceivedAudio = true;
                    hasProcessedAudioChunks = true;
                  } else {
                    // Buffer audio chunks until we get format
                    preFormatAudioChunks.push(audioPayload);
                    console.log('Wyoming: Buffering audio-chunk payload of', payloadLength, 'bytes (format not yet received)');
                    hasProcessedAudioChunks = true; // Mark that we've seen audio-chunk messages
                  }
                  
                  // Remove the message and payload from buffer
                  buffer = buffer.subarray(payloadEnd);
                  searchStart = 0; // Reset search to start of buffer
                  continue;
                } else {
                  // Don't have full payload yet - wait for more data
                  console.log('Wyoming: Waiting for more data, need', payloadEnd, 'have', buffer.length);
                  break;
                }
              }
              
              // Other JSON message - skip it and continue searching
              searchStart = newlineIndex + 1;
            } catch (error) {
              // Not valid JSON - continue searching
              searchStart = braceIndex + 1;
            }
          } else {
            // Incomplete JSON - continue searching
            searchStart = braceIndex + 1;
          }
        }
        
        // If we found format, continue processing; otherwise wait for more data
        if (!formatFound) {
          break;
        }
      }
    });

    socket.on('error', (error: Error) => {
      if (isWyomingUnreachableMessage(error.message)) {
        logWyomingUnreachableThrottled(config.hostname, config.port, error.message);
        if (PIPER_TTS_DEBUG) console.error('Wyoming: TCP error:', error.message);
      } else {
        console.error('Wyoming: TCP error:', error.message);
      }
      abortSignal.removeEventListener('abort', abortHandler);
      cleanup();
      clearTimeout(timeout);
      if (!isResolved) {
        isResolved = true;
        reject(new Error(`TCP error: ${error.message}`));
      }
    });

    socket.on('close', () => {
      piperDebug(
        'Wyoming: Connection closed, hasReceivedAudio:',
        hasReceivedAudio,
        'buffer length:',
        buffer.length,
        'buffered chunks:',
        preFormatAudioChunks.length
      );
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      abortSignal.removeEventListener('abort', abortHandler);
      cleanup();
      clearTimeout(timeout);
      
      // If we have buffered audio chunks but no format, use default format
      if (!abortSignal.aborted && preFormatAudioChunks.length > 0 && !audioFormat) {
        console.warn('Wyoming: Format message never received before connection close, using default format for', preFormatAudioChunks.length, 'buffered chunks');
        // Default Piper TTS format: 22050 Hz, 16-bit (width=2), mono (channels=1)
        audioFormat = {
          rate: 22050,
          width: 2,
          channels: 1,
        };
        console.log('Wyoming: Using default audio format:', audioFormat);
        
        // Send format notification
        onChunk(new Uint8Array(0), audioFormat);
        
        // Process buffered chunks
        for (const chunk of preFormatAudioChunks) {
          onChunk(chunk);
          hasReceivedAudio = true;
        }
        preFormatAudioChunks.length = 0;
        hasProcessedAudioChunks = true;
      }
      
      // Only process remaining buffer if not aborted
      if (!abortSignal.aborted && buffer.length > 0 && audioFormat) {
        console.log('Wyoming: Streaming remaining buffer:', buffer.length, 'bytes');
        onChunk(new Uint8Array(buffer));
        hasReceivedAudio = true;
      }

      if (!isResolved) {
        isResolved = true;
        if (abortSignal.aborted) {
          piperDebug('Wyoming: Connection closed after abort');
          reject(new Error('Operation cancelled'));
        } else if (hasReceivedAudio) {
          piperDebug('Wyoming: Resolving - audio received');
          resolve();
        } else {
          piperDebug('Wyoming: Rejecting - no audio received');
          reject(new Error('Connection closed without audio data'));
        }
      }
    });
  });
}

function getTcpConfig(): { hostname: string; port: number } {
  // Allow override via environment variable
  const piperHost = process.env.PIPER_TTS_HOST || process.env.PIPER_HOST;
  const piperPort = process.env.PIPER_TTS_PORT || process.env.PIPER_PORT;
  
  if (piperHost && piperPort) {
    return {
      hostname: piperHost,
      port: parseInt(piperPort, 10),
    };
  }
  
  // Default: use Docker service name in production, localhost in development
  const isDevelopment = process.env.NODE_ENV === 'development';
  return {
    hostname: isDevelopment ? 'localhost' : 'piper-tts',
    port: 10200,
  };
}

function createWavHeader(sampleRate: number, bytesPerSample: number, channels: number, dataSize: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  
  // RIFF header
  view.setUint8(0, 0x52); // 'R'
  view.setUint8(1, 0x49); // 'I'
  view.setUint8(2, 0x46); // 'F'
  view.setUint8(3, 0x46); // 'F'
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  
  // WAVE header
  view.setUint8(8, 0x57);  // 'W'
  view.setUint8(9, 0x41);  // 'A'
  view.setUint8(10, 0x56); // 'V'
  view.setUint8(11, 0x45); // 'E'
  
  // fmt chunk
  view.setUint8(12, 0x66); // 'f'
  view.setUint8(13, 0x6D); // 'm'
  view.setUint8(14, 0x74); // 't'
  view.setUint8(15, 0x20); // ' '
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, channels, true); // Number of channels
  view.setUint32(24, sampleRate, true); // Sample rate
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); // Byte rate
  view.setUint16(32, channels * bytesPerSample, true); // Block align
  view.setUint16(34, bytesPerSample * 8, true); // Bits per sample
  
  // data chunk
  view.setUint8(36, 0x64); // 'd'
  view.setUint8(37, 0x61); // 'a'
  view.setUint8(38, 0x74); // 't'
  view.setUint8(39, 0x61); // 'a'
  view.setUint32(40, dataSize, true); // Data size
  
  return new Uint8Array(header);
}

function filterCryptographicContent(text: string): string {
  let filtered = text;
  
  // Remove URLs
  filtered = filtered.replace(/https?:\/\/[^\s]+/gi, '');
  filtered = filtered.replace(/www\.[^\s]+/gi, '');
  
  // Remove Nostr URIs and bech32 addresses
  filtered = filtered.replace(/nostr:[^\s]+/gi, '');
  filtered = filtered.replace(/\b(npub|note|nevent|naddr|nprofile|nsec|ncryptsec)1[a-z0-9]{20,}\b/gi, '');
  
  // Remove hex strings
  filtered = filtered.replace(/\b[0-9a-f]{64}\b/gi, '');
  filtered = filtered.replace(/\b[0-9a-f]{32,63}\b/gi, '');
  
  // Remove emojis
  filtered = filtered.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
  filtered = filtered.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
  filtered = filtered.replace(/[\u{2600}-\u{26FF}]/gu, '');
  filtered = filtered.replace(/[\u{2700}-\u{27BF}]/gu, '');
  
  // Remove markdown and asciidoc markup
  
  // Code blocks (markdown and asciidoc)
  filtered = filtered.replace(/```[\s\S]*?```/g, '');
  filtered = filtered.replace(/`[^`]+`/g, '');
  filtered = filtered.replace(/----[\s\S]*?----/g, ''); // AsciiDoc code blocks
  filtered = filtered.replace(/\[source[^\]]*\][\s\S]*?----/g, ''); // AsciiDoc source blocks
  
  // Headers (markdown and asciidoc)
  filtered = filtered.replace(/^#+\s+/gm, ''); // Markdown headers at start of line
  filtered = filtered.replace(/\s+#+\s+/g, ' '); // Markdown headers in middle of text
  filtered = filtered.replace(/^=+\s*$/gm, ''); // AsciiDoc headers (single line)
  filtered = filtered.replace(/^=+\s+/gm, ''); // AsciiDoc headers at start of line
  filtered = filtered.replace(/\s+=+\s+/g, ' '); // AsciiDoc headers in middle of text
  
  // Links (markdown and asciidoc)
  filtered = filtered.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Markdown links
  filtered = filtered.replace(/\[\[([^\]]+)\]\]/g, '$1'); // AsciiDoc links
  filtered = filtered.replace(/link:([^\[]+)\[([^\]]+)\]/g, '$2'); // AsciiDoc link: syntax
  
  // Images (markdown and asciidoc)
  filtered = filtered.replace(/!\[([^\]]*)\]\([^\)]+\)/g, ''); // Markdown images
  filtered = filtered.replace(/image::?[^\[]+\[([^\]]*)\]/g, '$1'); // AsciiDoc images
  
  // Emphasis and formatting
  filtered = filtered.replace(/\*\*([^*]+)\*\*/g, '$1'); // Bold markdown
  filtered = filtered.replace(/\*([^*]+)\*/g, '$1'); // Italic markdown
  filtered = filtered.replace(/__([^_]+)__/g, '$1'); // Bold markdown (underscore)
  filtered = filtered.replace(/_([^_]+)_/g, '$1'); // Italic markdown (underscore)
  filtered = filtered.replace(/\*\*([^*]+)\*\*/g, '$1'); // Bold asciidoc
  filtered = filtered.replace(/\*([^*]+)\*/g, '$1'); // Italic asciidoc
  filtered = filtered.replace(/\+\+([^+]+)\+\+/g, '$1'); // Monospace asciidoc
  filtered = filtered.replace(/~~([^~]+)~~/g, '$1'); // Strikethrough markdown
  
  // Lists (markdown and asciidoc)
  filtered = filtered.replace(/^[\*\-\+]\s+/gm, ''); // Markdown unordered lists
  filtered = filtered.replace(/^\d+\.\s+/gm, ''); // Markdown ordered lists
  filtered = filtered.replace(/^\.\s+/gm, ''); // AsciiDoc unordered lists
  filtered = filtered.replace(/^\d+\.\s+/gm, ''); // AsciiDoc ordered lists
  
  // Blockquotes
  filtered = filtered.replace(/^>\s+/gm, ''); // Markdown blockquotes
  filtered = filtered.replace(/^\[quote[^\]]*\][\s\S]*?\[quote\]/g, ''); // AsciiDoc quotes
  
  // Horizontal rules
  filtered = filtered.replace(/^[-*_]{3,}\s*$/gm, ''); // Markdown horizontal rules
  filtered = filtered.replace(/^'''+\s*$/gm, ''); // AsciiDoc horizontal rules
  
  // Tables (markdown and asciidoc)
  filtered = filtered.replace(/\|/g, ' '); // Remove table separators
  filtered = filtered.replace(/^\|.+\|\s*$/gm, ''); // Remove table rows
  filtered = filtered.replace(/^\[cols?=[^\]]*\][\s\S]*?\|===\s*$/gm, ''); // AsciiDoc tables
  
  // Other asciidoc syntax
  filtered = filtered.replace(/\[\[([^\]]+)\]\]/g, ''); // AsciiDoc anchors
  filtered = filtered.replace(/\[NOTE\]/gi, '');
  filtered = filtered.replace(/\[TIP\]/gi, '');
  filtered = filtered.replace(/\[WARNING\]/gi, '');
  filtered = filtered.replace(/\[IMPORTANT\]/gi, '');
  filtered = filtered.replace(/\[CAUTION\]/gi, '');
  filtered = filtered.replace(/\[source[^\]]*\]/gi, '');
  filtered = filtered.replace(/\[caption[^\]]*\]/gi, '');
  
  // Clean up whitespace
  filtered = filtered.replace(/\s+/g, ' ').trim();
  
  return filtered;
}

function splitIntoSentences(text: string): string[] {
  const cleaned = text
    .replace(/^#+\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
  
  const sentences: string[] = [];
  const regex = /([.!?]+)\s+/g;
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(cleaned)) !== null) {
    const sentence = cleaned.substring(lastIndex, match.index + match[1].length).trim();
    if (sentence.length > 0) {
      sentences.push(sentence);
    }
    lastIndex = match.index + match[0].length;
  }
  
  const remaining = cleaned.substring(lastIndex).trim();
  if (remaining.length > 0) {
    sentences.push(remaining);
  }
  
  return sentences.length > 0 ? sentences : [cleaned];
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Simple language detection based on character patterns
 * Returns language code (e.g., 'en', 'de', 'fr', 'es', etc.)
 */
function detectLanguage(text: string): string {
  if (!text || text.length === 0) return 'en';
  
  // Count character patterns to detect language
  const sample = text.substring(0, Math.min(500, text.length));
  
  // German: ä, ö, ü, ß
  const germanChars = (sample.match(/[äöüßÄÖÜ]/g) || []).length;
  // French: é, è, ê, ç, à, etc.
  const frenchChars = (sample.match(/[éèêëàâäçôùûüÉÈÊËÀÂÄÇÔÙÛÜ]/g) || []).length;
  // Spanish: ñ, á, é, í, ó, ú, ¿, ¡
  const spanishChars = (sample.match(/[ñáéíóúüÑÁÉÍÓÚÜ¿¡]/g) || []).length;
  // Italian: à, è, é, ì, ò, ù
  const italianChars = (sample.match(/[àèéìòùÀÈÉÌÒÙ]/g) || []).length;
  // Russian/Cyrillic
  const cyrillicChars = (sample.match(/[а-яёА-ЯЁ]/g) || []).length;
  // CJK scripts: Hangul / kana → English Piper (no ko/ja models); Han → Chinese when dominant.
  const hangulChars = (sample.match(/[\uac00-\ud7af]/g) || []).length;
  const kanaChars = (sample.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  const hanChars = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  // Arabic
  const arabicChars = (sample.match(/[\u0600-\u06ff]/g) || []).length;
  
  // Calculate ratios
  const total = sample.length;
  const germanRatio = germanChars / total;
  const frenchRatio = frenchChars / total;
  const spanishRatio = spanishChars / total;
  const italianRatio = italianChars / total;
  const cyrillicRatio = cyrillicChars / total;
  const hangulRatio = hangulChars / total;
  const kanaRatio = kanaChars / total;
  const hanRatio = hanChars / total;
  const arabicRatio = arabicChars / total;
  
  // Detect based on highest ratio
  if (cyrillicRatio > 0.1) return 'ru';
  if (hangulRatio > 0.06 || kanaRatio > 0.02) return 'en';
  if (hanRatio > 0.1) return 'zh';
  if (arabicRatio > 0.1) return 'ar';
  if (germanRatio > 0.02) return 'de';
  if (frenchRatio > 0.02) return 'fr';
  if (spanishRatio > 0.02) return 'es';
  if (italianRatio > 0.02) return 'it';
  
  // Default to English
  return 'en';
}

/**
 * Map language code to Piper voice name
 * Returns voice name (always returns a value, defaults to English)
 * Voice names follow pattern: {lang}_{locale}-{voice}-{quality}
 * 
 * Note: These are common voice names. You may need to adjust based on
 * which voices are actually available in your piper-data directory.
 * To see available voices, check the piper-data folder or Wyoming server logs.
 */
function getVoiceForLanguage(lang: string): string {
  // Voice map keys / ids: keep in sync with `src/lib/trinity-languages.ts` (`TRINITY_PIPER_VOICE`, `EXTRA_READ_ALOUD_PIPER_VOICE`).
  const voiceMap: Record<string, string> = {
    'en': 'en_US-lessac-medium', // Default English voice
    'en-gb': 'en_GB-alan-medium', // British English (rhasspy/piper-voices; install via scripts/download-piper-extra-voices.sh)
    'de': 'de_DE-thorsten-medium', // German
    'fr': 'fr_FR-siwis-medium', // French
    'es': 'es_ES-davefx-medium', // Spanish
    'it': 'it_IT-paola-medium', // Italian (rhasspy/piper-voices; install via scripts/download-piper-extra-voices.sh)
    'ru': 'ru_RU-ruslan-medium', // Russian
    'zh': 'zh_CN-huayan-medium', // Chinese
    'ar': 'ar_JO-kareem-medium', // Arabic (rhasspy/piper-voices; install via scripts/download-piper-extra-voices.sh)
    'pl': 'pl_PL-darkman-medium', // Polish
    'pt': 'pt_BR-cadu-medium', // Portuguese (BR; rhasspy/piper-voices; same script)
    'nl': 'nl_NL-mls-medium', // Dutch
    'cs': 'cs_CZ-jirka-medium', // Czech
    'tr': 'tr_TR-dfki-medium', // Turkish
  };
  
  return voiceMap[lang] || voiceMap['en']; // Fall back to English
}
