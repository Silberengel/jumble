import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { formatPubkey } from '@/lib/pubkey'
import { getSpellName } from '@/services/spell.service'
import { FAUX_SPELL_ORDER } from '@/constants'
import { Check, Star } from 'lucide-react'
import type { Event } from 'nostr-tools'
import type { TFunction } from 'i18next'
import {
  encodeFollowSetSpellId,
  fauxSpellLabelKey,
  FAUX_SPELL_ICON,
  FOLLOW_SET_SPELL_ROW_ICON,
  getFollowSetDTag,
  labelFollowSetEvent
} from './fauxSpellConfig'

function spellPickerPrimaryAndSecondary(
  spell: Event,
  accountPubkey: string | undefined,
  labelFor: (e: Event) => string,
  options?: { omitAuthorNpub?: boolean }
) {
  const primary = labelFor(spell)
  const isOwn = !!(accountPubkey && spell.pubkey === accountPubkey)
  const shortTitle = primary.trim().length < 4
  const secondaryParts: string[] = []
  if (!isOwn && !options?.omitAuthorNpub) secondaryParts.push(formatPubkey(spell.pubkey))
  if (shortTitle) secondaryParts.push(`${spell.id.slice(0, 8)}…`)
  return {
    primary,
    secondary: secondaryParts.length > 0 ? secondaryParts.join(' · ') : null
  }
}

export function groupSpellsByPubkeySorted(spells: Event[]): { pubkey: string; spells: Event[] }[] {
  const map = new Map<string, Event[]>()
  for (const s of spells) {
    const list = map.get(s.pubkey)
    if (list) list.push(s)
    else map.set(s.pubkey, [s])
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      getSpellName(a).localeCompare(getSpellName(b), undefined, { sensitivity: 'base' })
    )
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pk, list]) => ({ pubkey: pk, spells: list }))
}

function SpellSheetAuthorHeader({ userId }: { userId: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
      <UserAvatar userId={userId} size="small" className="shrink-0" />
      <Username
        userId={userId}
        className="min-w-0 text-sm font-semibold"
        skeletonClassName="h-4 w-28"
      />
    </div>
  )
}

function SpellSheetOptionRow({
  spell,
  selected,
  accountPubkey,
  labelFor,
  onPick,
  groupedUnderAuthor = false,
  starred = false,
  onToggleStar,
  starTitleAdd,
  starTitleRemove,
  t
}: {
  spell: Event
  selected: boolean
  accountPubkey: string | undefined
  labelFor: (e: Event) => string
  onPick: (e: Event) => void
  groupedUnderAuthor?: boolean
  starred?: boolean
  onToggleStar?: (spell: Event) => void
  starTitleAdd?: string
  starTitleRemove?: string
  t: TFunction
}) {
  const { primary, secondary } = spellPickerPrimaryAndSecondary(spell, accountPubkey, labelFor, {
    omitAuthorNpub: groupedUnderAuthor
  })
  return (
    <div
      className={cn(
        'flex w-full items-stretch gap-0.5 rounded-lg transition-colors',
        selected && 'bg-accent/50'
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={selected}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors',
          'hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'rounded-lg'
        )}
        onClick={() => onPick(spell)}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {selected ? <Check className="size-4" aria-hidden /> : null}
        </span>
        <div className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5">
          <span className="truncate text-left font-medium leading-tight">{primary}</span>
          {secondary ? (
            <span className="truncate text-left text-xs text-muted-foreground">{secondary}</span>
          ) : null}
        </div>
      </button>
      {onToggleStar ? (
        <button
          type="button"
          className="flex shrink-0 items-center justify-center rounded-lg px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={starred ? starTitleRemove ?? t('Remove from favorites') : starTitleAdd ?? t('Add to favorites')}
          aria-label={starred ? starTitleRemove ?? t('Remove from favorites') : starTitleAdd ?? t('Add to favorites')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggleStar(spell)
          }}
        >
          <Star
            className={cn('size-4', starred && 'fill-amber-400 text-amber-500')}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  )
}

export type SpellPickerContentProps = {
  t: TFunction
  pubkey: string | null | undefined
  selectedSpell: Event | null
  selectedFauxSpell: string | null
  favoriteSpellSet: Set<string>
  starredSpellsForPicker: Event[]
  ownSpells: Event[]
  followSpells: Event[]
  otherSpells: Event[]
  followSetListEvents: Event[]
  spellMenuLabel: (spell: Event) => string
  spellStarAddTitle: string
  spellStarRemoveTitle: string
  pickSpell: (spell: Event | null) => void
  pickFauxSpell: (name: string | null) => void
  clearSpellSelection: () => void
  toggleFavoriteSpell: (spell: Event) => void
}

export function SpellPickerContent({
  t,
  pubkey,
  selectedSpell,
  selectedFauxSpell,
  favoriteSpellSet,
  starredSpellsForPicker,
  ownSpells,
  followSpells,
  otherSpells,
  followSetListEvents,
  spellMenuLabel,
  spellStarAddTitle,
  spellStarRemoveTitle,
  pickSpell,
  pickFauxSpell,
  clearSpellSelection,
  toggleFavoriteSpell
}: SpellPickerContentProps) {
  const followSpellGroups = groupSpellsByPubkeySorted(followSpells)
  const otherSpellGroups = groupSpellsByPubkeySorted(otherSpells)

  return (
    <>
      {starredSpellsForPicker.length > 0 ? (
        <>
          <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('Starred spells')}
          </p>
          {starredSpellsForPicker.map((spell) => (
            <SpellSheetOptionRow
              key={spell.id}
              spell={spell}
              selected={selectedSpell?.id === spell.id}
              accountPubkey={pubkey ?? undefined}
              labelFor={(e) => getSpellName(e)}
              onPick={pickSpell}
              starred
              t={t}
              onToggleStar={(s) => void toggleFavoriteSpell(s)}
              starTitleAdd={spellStarAddTitle}
              starTitleRemove={spellStarRemoveTitle}
            />
          ))}
          <Separator className="my-2" />
        </>
      ) : null}
      {FAUX_SPELL_ORDER.flatMap((name) => {
        if (
          (name === 'notifications' ||
            name === 'following' ||
            name === 'heatMap' ||
            name === 'bookmarks' ||
            name === 'interests') &&
          !pubkey
        ) {
          return []
        }
        const Icon = FAUX_SPELL_ICON[name]
        const selected = selectedFauxSpell === name
        const builtinRow = (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={selected}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
              'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'bg-accent/50'
            )}
            onClick={() => pickFauxSpell(name)}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {selected ? <Check className="size-4" aria-hidden /> : null}
            </span>
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {t(fauxSpellLabelKey(name))}
            </span>
          </button>
        )
        if (name !== 'following' || !pubkey || followSetListEvents.length === 0) {
          return [builtinRow]
        }
        const setRows = followSetListEvents.flatMap((ev) => {
          const d = getFollowSetDTag(ev)
          if (!d) return []
          const spellId = encodeFollowSetSpellId(d)
          const setSelected = selectedFauxSpell === spellId
          return [
            <button
              key={spellId}
              type="button"
              role="option"
              aria-selected={setSelected}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 pl-8 text-left text-sm transition-colors',
                'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                setSelected && 'bg-accent/50'
              )}
              onClick={() => pickFauxSpell(spellId)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {setSelected ? <Check className="size-4" aria-hidden /> : null}
              </span>
              <FOLLOW_SET_SPELL_ROW_ICON className="size-4 shrink-0 opacity-80" />
              <span className="min-w-0 flex-1 truncate text-left font-medium">
                {labelFollowSetEvent(ev)}
              </span>
            </button>
          ]
        })
        return [builtinRow, ...setRows]
      })}
      <button
        type="button"
        role="option"
        aria-selected={!selectedSpell && !selectedFauxSpell}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
          'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !selectedSpell && !selectedFauxSpell && 'bg-accent/50'
        )}
        onClick={clearSpellSelection}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {!selectedSpell && !selectedFauxSpell ? <Check className="size-4" aria-hidden /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-left font-normal text-muted-foreground">
          {t('Select a spell…')}
        </span>
      </button>

      {ownSpells.length > 0 ? (
        <>
          <Separator className="my-2" />
          <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('spellPickerSectionYours')}
          </p>
          {ownSpells.map((spell) => (
            <SpellSheetOptionRow
              key={spell.id}
              spell={spell}
              selected={selectedSpell?.id === spell.id}
              accountPubkey={pubkey ?? undefined}
              labelFor={spellMenuLabel}
              onPick={pickSpell}
              t={t}
              starred={favoriteSpellSet.has(spell.id.toLowerCase())}
              onToggleStar={(s) => void toggleFavoriteSpell(s)}
              starTitleAdd={spellStarAddTitle}
              starTitleRemove={spellStarRemoveTitle}
            />
          ))}
        </>
      ) : null}

      {followSpells.length > 0 ? (
        <>
          <Separator className="my-2" />
          <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('Spells from follows', { count: followSpells.length })}
          </p>
          {followSpellGroups.map(({ pubkey: authorPk, spells: groupSpells }) => (
            <div key={authorPk} className="mt-2 overflow-hidden rounded-lg border border-border/60">
              <SpellSheetAuthorHeader userId={authorPk} />
              <div className="px-0.5 py-0.5">
                {groupSpells.map((spell) => (
                  <SpellSheetOptionRow
                    key={spell.id}
                    spell={spell}
                    selected={selectedSpell?.id === spell.id}
                    accountPubkey={pubkey ?? undefined}
                    labelFor={spellMenuLabel}
                    onPick={pickSpell}
                    t={t}
                    groupedUnderAuthor
                    starred={favoriteSpellSet.has(spell.id.toLowerCase())}
                    onToggleStar={(s) => void toggleFavoriteSpell(s)}
                    starTitleAdd={spellStarAddTitle}
                    starTitleRemove={spellStarRemoveTitle}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {otherSpells.length > 0 ? (
        <>
          <Separator className="my-2" />
          <p className="px-3 pb-1 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('Other spells', { count: otherSpells.length })}
          </p>
          {otherSpellGroups.map(({ pubkey: authorPk, spells: groupSpells }) => (
            <div key={authorPk} className="mt-2 overflow-hidden rounded-lg border border-border/60">
              <SpellSheetAuthorHeader userId={authorPk} />
              <div className="px-0.5 py-0.5">
                {groupSpells.map((spell) => (
                  <SpellSheetOptionRow
                    key={spell.id}
                    spell={spell}
                    selected={selectedSpell?.id === spell.id}
                    accountPubkey={pubkey ?? undefined}
                    labelFor={spellMenuLabel}
                    onPick={pickSpell}
                    t={t}
                    groupedUnderAuthor
                    starred={favoriteSpellSet.has(spell.id.toLowerCase())}
                    onToggleStar={(s) => void toggleFavoriteSpell(s)}
                    starTitleAdd={spellStarAddTitle}
                    starTitleRemove={spellStarRemoveTitle}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}
    </>
  )
}
