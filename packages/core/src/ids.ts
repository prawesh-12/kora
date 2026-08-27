import { monotonicFactory } from 'ulid';

// Plain ulid() randomises the low bits, so ids minted in the same millisecond do not
// sort by creation order. Traces and step ordinals depend on that ordering.
const ulid = monotonicFactory();

export type Prefix =
  | 'ten'
  | 'usr'
  | 'conv'
  | 'msg'
  | 'run'
  | 'stp'
  | 'tr'
  | 'tex'
  | 'pck'
  | 'doc'
  | 'chk'
  | 'esc'
  | 'ev'
  | 'evr'
  | 'llm'
  | 'idm'
  | 'apv'
  | 'agt'
  | 'agv'
  | 'pol'
  | 'plv';

export type Id<P extends Prefix> = `${P}_${string}`;

export function newId<P extends Prefix>(p: P): Id<P> {
  return `${p}_${ulid()}`;
}

export function isId<P extends Prefix>(p: P, value: unknown): value is Id<P> {
  return typeof value === 'string' && value.startsWith(`${p}_`) && value.length > p.length + 1;
}
