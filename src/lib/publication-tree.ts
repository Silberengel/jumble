import { ExtendedKind } from '@/constants'
import { Lazy } from '@/lib/lazy'
import {
  eventTagAddress,
  fetchMissingIndexByAddress
} from '@/lib/publication-index'
import {
  parsePublicationATagCoordinate,
  resolvePublicationEventIdToHex
} from '@/lib/publication-section-fetch'
import client, { queryService } from '@/services/client.service'
import type { Event } from 'nostr-tools'

enum PublicationTreeNodeType {
  Branch,
  Leaf
}

enum PublicationTreeNodeStatus {
  Resolved,
  Error
}

export enum TreeTraversalMode {
  Leaves,
  All
}

enum TreeTraversalDirection {
  Forward,
  Backward
}

interface PublicationTreeNode {
  type: PublicationTreeNodeType
  status: PublicationTreeNodeStatus
  address: string
  parent?: PublicationTreeNode
  children?: Array<Lazy<PublicationTreeNode>>
}

async function findIndexAsync<T>(
  array: T[],
  predicate: (element: T, index: number, array: T[]) => Promise<boolean>
): Promise<number> {
  for (let i = 0; i < array.length; i++) {
    if (await predicate(array[i], i, array)) return i
  }
  return -1
}

async function fetchEventByAddress(address: string, relayUrls: string[]): Promise<Event | null> {
  const parsed = parsePublicationATagCoordinate(address)
  if (!parsed) return null
  const fromIndex = await fetchMissingIndexByAddress(address, relayUrls)
  if (fromIndex) return fromIndex
  const events = await queryService.fetchEvents(
    relayUrls,
    [
      {
        kinds: [parsed.kind],
        authors: [parsed.pubkey],
        '#d': [parsed.identifier],
        limit: 3
      }
    ],
    { globalTimeout: 8000, eoseTimeout: 2000, firstRelayResultGraceMs: false }
  )
  if (events.length === 0) return null
  return events.sort((a, b) => b.created_at - a.created_at)[0]
}

/**
 * Lazy NKBIP-01 publication tree for nested 30040 → 30041 reading.
 * Adapted from Alexandria's PublicationTree.
 */
export class PublicationTree implements AsyncIterable<Event | null> {
  #root: PublicationTreeNode
  #nodes: Map<string, Lazy<PublicationTreeNode>>
  #events: Map<string, Event>
  #eventCache = new Map<string, Event>()
  #bookmark?: string
  #visitedNodes = new Set<string>()
  #relayUrls: string[]
  #nodeAddedObservers: Array<(address: string) => void> = []
  #nodeResolvedObservers: Array<(address: string) => void> = []
  #bookmarkMovedObservers: Array<(address: string) => void> = []

  constructor(rootEvent: Event, relayUrls: string[]) {
    const rootAddress = eventTagAddress(rootEvent)
    if (!rootAddress) {
      throw new Error('PublicationTree: root event has no d-tag address')
    }
    this.#root = {
      type: PublicationTreeNodeType.Branch,
      status: PublicationTreeNodeStatus.Resolved,
      address: rootAddress,
      children: []
    }
    this.#nodes = new Map<string, Lazy<PublicationTreeNode>>()
    this.#nodes.set(rootAddress, new Lazy(() => Promise.resolve(this.#root)))
    this.#events = new Map<string, Event>()
    this.#events.set(rootAddress, rootEvent)
    this.#relayUrls = relayUrls
  }

  async getEvent(address: string): Promise<Event | null> {
    const cached = this.#events.get(address)
    if (cached) return cached
    return this.#depthFirstRetrieve(address)
  }

  async getChildAddresses(address: string): Promise<Array<string | null>> {
    const node = await this.#nodes.get(address)?.value()
    if (!node) {
      throw new Error(`[PublicationTree] Node with address ${address} not found.`)
    }
    return Promise.all(
      node.children?.map(async (child) => (await child.value())?.address ?? null) ?? []
    )
  }

  async getHierarchy(address: string): Promise<Event[]> {
    let node = await this.#nodes.get(address)?.value()
    if (!node) {
      throw new Error(`[PublicationTree] Node with address ${address} not found.`)
    }
    const hierarchy: Event[] = [this.#events.get(address)!]
    while (node.parent) {
      hierarchy.push(this.#events.get(node.parent.address)!)
      node = node.parent
    }
    return hierarchy.reverse()
  }

  setBookmark(address: string) {
    this.#bookmark = address
    void this.#cursor.tryMoveTo(address).then((success) => {
      if (success) {
        this.#bookmarkMovedObservers.forEach((observer) => observer(address))
      }
    })
  }

  resetCursor() {
    this.#bookmark = undefined
    this.#cursor.target = null
  }

  resetIterator() {
    this.resetCursor()
    this.#visitedNodes.clear()
    const rootAddress = this.#root.address
    this.#nodes.clear()
    this.#nodes.set(rootAddress, new Lazy(() => Promise.resolve(this.#root)))
    this.#events.clear()
    this.#eventCache.clear()
    void this.#cursor.tryMoveTo()
  }

  onBookmarkMoved(observer: (address: string) => void) {
    this.#bookmarkMovedObservers.push(observer)
  }

  onNodeAdded(observer: (address: string) => void) {
    this.#nodeAddedObservers.push(observer)
  }

  onNodeResolved(observer: (address: string) => void) {
    this.#nodeResolvedObservers.push(observer)
  }

  #cursor = new (class {
    target: PublicationTreeNode | null | undefined
    #tree: PublicationTree

    constructor(tree: PublicationTree) {
      this.#tree = tree
    }

    async tryMoveTo(address?: string) {
      if (!address) {
        const startEvent = await this.#tree.#depthFirstRetrieve()
        if (!startEvent) return false
        const addr = eventTagAddress(startEvent)
        if (!addr) return false
        this.target = await this.#tree.#nodes.get(addr)?.value()
      } else {
        this.target = await this.#tree.#nodes.get(address)?.value()
      }
      return !!this.target
    }

    async tryMoveToFirstChild(): Promise<boolean> {
      if (!this.target || this.target.type === PublicationTreeNodeType.Leaf) return false
      if (!this.target.children?.length) return false
      this.target = await this.target.children.at(0)?.value()
      return !!this.target
    }

    async tryMoveToLastChild(): Promise<boolean> {
      if (!this.target || this.target.type === PublicationTreeNodeType.Leaf) return false
      if (!this.target.children?.length) return false
      this.target = await this.target.children.at(-1)?.value()
      return !!this.target
    }

    async tryMoveToNextSibling(): Promise<boolean> {
      if (!this.target) return false
      const siblings = this.target.parent?.children
      if (!siblings) return false
      const currentIndex = await findIndexAsync(siblings, async (sibling) => {
        return (await sibling.value())?.address === this.target!.address
      })
      if (currentIndex === -1 || currentIndex + 1 >= siblings.length) return false
      this.target = await siblings.at(currentIndex + 1)?.value()
      return !!this.target
    }

    async tryMoveToPreviousSibling(): Promise<boolean> {
      if (!this.target) return false
      const siblings = this.target.parent?.children
      if (!siblings) return false
      const currentIndex = await findIndexAsync(siblings, async (sibling) => {
        return (await sibling.value())?.address === this.target!.address
      })
      if (currentIndex <= 0) return false
      this.target = await siblings.at(currentIndex - 1)?.value()
      return !!this.target
    }

    tryMoveToParent(): boolean {
      if (!this.target?.parent) return false
      this.target = this.target.parent
      return true
    }
  })(this);

  [Symbol.asyncIterator](): AsyncIterator<Event | null> {
    return this
  }

  async next(mode: TreeTraversalMode = TreeTraversalMode.Leaves): Promise<IteratorResult<Event | null>> {
    if (!this.#cursor.target) {
      if (await this.#cursor.tryMoveTo(this.#bookmark)) {
        return this.#yieldEventAtCursor(false)
      }
    }
    switch (mode) {
      case TreeTraversalMode.Leaves:
        return this.#walkLeaves(TreeTraversalDirection.Forward)
      case TreeTraversalMode.All:
        return this.#preorderWalkAll(TreeTraversalDirection.Forward)
    }
  }

  async previous(mode: TreeTraversalMode = TreeTraversalMode.Leaves): Promise<IteratorResult<Event | null>> {
    if (!this.#cursor.target) {
      if (await this.#cursor.tryMoveTo(this.#bookmark)) {
        return this.#yieldEventAtCursor(false)
      }
    }
    switch (mode) {
      case TreeTraversalMode.Leaves:
        return this.#walkLeaves(TreeTraversalDirection.Backward)
      case TreeTraversalMode.All:
        return this.#preorderWalkAll(TreeTraversalDirection.Backward)
    }
  }

  async #yieldEventAtCursor(done: boolean): Promise<IteratorResult<Event | null>> {
    if (!this.#cursor.target) return { done, value: null }
    const address = this.#cursor.target.address
    if (this.#visitedNodes.has(address)) return { done: false, value: null }
    this.#visitedNodes.add(address)
    const value = (await this.getEvent(address)) ?? null
    return { done, value }
  }

  async #walkLeaves(direction: TreeTraversalDirection): Promise<IteratorResult<Event | null>> {
    const tryMoveToSibling =
      direction === TreeTraversalDirection.Forward
        ? this.#cursor.tryMoveToNextSibling.bind(this.#cursor)
        : this.#cursor.tryMoveToPreviousSibling.bind(this.#cursor)
    const tryMoveToChild =
      direction === TreeTraversalDirection.Forward
        ? this.#cursor.tryMoveToFirstChild.bind(this.#cursor)
        : this.#cursor.tryMoveToLastChild.bind(this.#cursor)

    do {
      if (await tryMoveToSibling()) {
        while (await tryMoveToChild()) continue
        if (this.#cursor.target?.status === PublicationTreeNodeStatus.Error) {
          return { done: false, value: null }
        }
        return this.#yieldEventAtCursor(false)
      }
    } while (this.#cursor.tryMoveToParent())

    return { done: true, value: null }
  }

  async #preorderWalkAll(direction: TreeTraversalDirection): Promise<IteratorResult<Event | null>> {
    const tryMoveToSibling =
      direction === TreeTraversalDirection.Forward
        ? this.#cursor.tryMoveToNextSibling.bind(this.#cursor)
        : this.#cursor.tryMoveToPreviousSibling.bind(this.#cursor)
    const tryMoveToChild =
      direction === TreeTraversalDirection.Forward
        ? this.#cursor.tryMoveToFirstChild.bind(this.#cursor)
        : this.#cursor.tryMoveToLastChild.bind(this.#cursor)

    if (await tryMoveToChild()) return this.#yieldEventAtCursor(false)
    do {
      if (await tryMoveToSibling()) return this.#yieldEventAtCursor(false)
    } while (this.#cursor.tryMoveToParent())
    return this.#yieldEventAtCursor(true)
  }

  async #depthFirstRetrieve(address?: string): Promise<Event | null> {
    if (address && this.#nodes.has(address)) {
      return this.#events.get(address) ?? null
    }

    const stack: string[] = [this.#root.address]
    while (stack.length > 0) {
      const currentAddress = stack.pop()!
      const currentNode = await this.#nodes.get(currentAddress)?.value()
      if (!currentNode) return null

      let currentEvent = this.#events.get(currentAddress)
      if (!currentEvent) return null
      if (address != null && currentAddress === address) return currentEvent

      let currentChildAddresses = currentEvent.tags
        .filter((tag) => tag[0] === 'a' && tag[1])
        .map((tag) => tag[1])

      if (currentChildAddresses.length === 0) {
        const eTags = currentEvent.tags.filter(
          (tag) => tag[0] === 'e' && tag[1] && /^[0-9a-fA-F]{64}$/.test(tag[1])
        )
        const resolved = await Promise.all(
          eTags.map(async (tag) => {
            const hex = resolvePublicationEventIdToHex(tag[1])
            if (!hex) return null
            const ev = await client.fetchEvent(hex)
            if (!ev) return null
            return eventTagAddress(ev)
          })
        )
        currentChildAddresses = resolved.filter((a): a is string => !!a)
      }

      if (currentChildAddresses.length === 0) {
        if (address == null) return currentEvent
        continue
      }

      await Promise.all(
        currentChildAddresses
          .filter((childAddress) => !this.#nodes.has(childAddress))
          .map((childAddress) => this.#addNode(childAddress, currentNode))
      )

      while (currentChildAddresses.length > 0) {
        stack.push(currentChildAddresses.pop()!)
      }
    }

    return null
  }

  #addNode(address: string, parentNode: PublicationTreeNode) {
    const lazyNode = new Lazy(() => this.#resolveNode(address, parentNode))
    parentNode.children!.push(lazyNode)
    this.#nodes.set(address, lazyNode)
    this.#nodeAddedObservers.forEach((observer) => observer(address))
  }

  async #resolveNode(address: string, parentNode: PublicationTreeNode): Promise<PublicationTreeNode> {
    let event = this.#eventCache.get(address)
    if (!event) {
      event = (await fetchEventByAddress(address, this.#relayUrls)) ?? undefined
      if (event) this.#eventCache.set(address, event)
    }

    if (!event) {
      return {
        type: PublicationTreeNodeType.Leaf,
        status: PublicationTreeNodeStatus.Error,
        address,
        parent: parentNode,
        children: []
      }
    }

    return this.#buildNodeFromEvent(event, address, parentNode)
  }

  async #buildNodeFromEvent(
    event: Event,
    address: string,
    parentNode: PublicationTreeNode
  ): Promise<PublicationTreeNode> {
    this.#events.set(address, event)
    const childAddresses = event.tags.filter((tag) => tag[0] === 'a' && tag[1]).map((tag) => tag[1])
    const node: PublicationTreeNode = {
      type: this.#getNodeType(event),
      status: PublicationTreeNodeStatus.Resolved,
      address,
      parent: parentNode,
      children: []
    }
    for (const childAddress of childAddresses) {
      this.#addNode(childAddress, node)
    }
    this.#nodeResolvedObservers.forEach((observer) => observer(address))
    return node
  }

  #getNodeType(event: Event): PublicationTreeNodeType {
    if (event.kind === ExtendedKind.PUBLICATION) {
      const hasChildren = event.tags.some((tag) => tag[0] === 'a')
      return hasChildren ? PublicationTreeNodeType.Branch : PublicationTreeNodeType.Leaf
    }
    if (
      event.kind === ExtendedKind.PUBLICATION_CONTENT ||
      event.kind === 30818 ||
      event.kind === 30023
    ) {
      return PublicationTreeNodeType.Leaf
    }
    const hasChildren = event.tags.some((tag) => tag[0] === 'a')
    return hasChildren ? PublicationTreeNodeType.Branch : PublicationTreeNodeType.Leaf
  }
}

export { fetchEventByAddress as fetchPublicationTreeEventByAddress }
