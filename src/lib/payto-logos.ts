/**
 * Explicit Vite `?url` imports so every payto logo is emitted under `/assets/` in production.
 * Keep files in `src/assets/payto_logos/` (not `public/`).
 */
import applePaySvg from '../assets/payto_logos/apple_pay.svg?url'
import bitcoinCashLogo from '../assets/payto_logos/bitcoin-cash-bch-logo.svg?url'
import bnbPng from '../assets/payto_logos/BNB.png?url'
import buyMeACoffeePng from '../assets/payto_logos/buymeacoffee.png?url'
import cashappWebp from '../assets/payto_logos/cashapp.webp?url'
import daiLogo from '../assets/payto_logos/multi-collateral-dai-dai-logo.svg?url'
import dogecoinLogo from '../assets/payto_logos/dogecoin-doge-logo.svg?url'
import ethLogo from '../assets/payto_logos/ethereum-eth-logo.svg?url'
import eurocPng from '../assets/payto_logos/EurC.png?url'
import geyserWebp from '../assets/payto_logos/geyser_fund.webp?url'
import githubSponsorsPng from '../assets/payto_logos/github_sponsors.png?url'
import gofundmeJpeg from '../assets/payto_logos/gofundme.jpeg?url'
import googlePayJpeg from '../assets/payto_logos/google_pay.jpeg?url'
import kickstarterWebp from '../assets/payto_logos/kickstarter.webp?url'
import kofiPng from '../assets/payto_logos/ko-fi.png?url'
import lbtcSvg from '../assets/payto_logos/LBTC.svg?url'
import litecoinPng from '../assets/payto_logos/Litecoin.png?url'
import moneroPng from '../assets/payto_logos/Monero.png?url'
import patreonPng from '../assets/payto_logos/patreon.png?url'
import paypalWebp from '../assets/payto_logos/paypal.webp?url'
import revolutWebp from '../assets/payto_logos/revolut.webp?url'
import solanaPng from '../assets/payto_logos/solana.png?url'
import tetherLogo from '../assets/payto_logos/tether-usdt-logo.svg?url'
import tronPng from '../assets/payto_logos/Tron.png?url'
import usdcLogo from '../assets/payto_logos/usd-coin-usdc-logo.svg?url'
import venmoPng from '../assets/payto_logos/venmo.png?url'
import xrpGif from '../assets/payto_logos/XRP.gif?url'

export const PAYTO_LOGO_URL_BY_FILENAME: Record<string, string> = {
  'apple_pay.svg': applePaySvg,
  'bitcoin-cash-bch-logo.svg': bitcoinCashLogo,
  'BNB.png': bnbPng,
  'buymeacoffee.png': buyMeACoffeePng,
  'cashapp.webp': cashappWebp,
  'multi-collateral-dai-dai-logo.svg': daiLogo,
  'dogecoin-doge-logo.svg': dogecoinLogo,
  'ethereum-eth-logo.svg': ethLogo,
  'EurC.png': eurocPng,
  'geyser_fund.webp': geyserWebp,
  'github_sponsors.png': githubSponsorsPng,
  'gofundme.jpeg': gofundmeJpeg,
  'google_pay.jpeg': googlePayJpeg,
  'kickstarter.webp': kickstarterWebp,
  'ko-fi.png': kofiPng,
  'LBTC.svg': lbtcSvg,
  'Litecoin.png': litecoinPng,
  'Monero.png': moneroPng,
  'patreon.png': patreonPng,
  'paypal.webp': paypalWebp,
  'revolut.webp': revolutWebp,
  'solana.png': solanaPng,
  'tether-usdt-logo.svg': tetherLogo,
  'Tron.png': tronPng,
  'usd-coin-usdc-logo.svg': usdcLogo,
  'venmo.png': venmoPng,
  'XRP.gif': xrpGif
}
