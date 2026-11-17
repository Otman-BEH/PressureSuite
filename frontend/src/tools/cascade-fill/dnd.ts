import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core'

export type TemplateKind = 'bundle' | 'bottle' | 'cooldown' | 'booster' | 'compressor' | 'bundle_manifold'

export const isMachine = (kind: TemplateKind): kind is 'booster' | 'compressor' => kind === 'booster' || kind === 'compressor'

/** What is being dragged; stored in each draggable's `data`. */
export type DragData =
  | { origin: 'template'; kind: TemplateKind }
  | { origin: 'pool'; sourceId: string }
  | { origin: 'sequence'; uid: string }

export const POOL_ZONE = 'zone:pool'
export const SEQUENCE_ZONE = 'zone:sequence'

/** Prefer the sequence card under the pointer (insert before it); otherwise the zone. */
export const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  const card = hits.find((h) => !String(h.id).startsWith('zone:'))
  if (card) return [card]
  return hits.length ? hits : rectIntersection(args)
}
