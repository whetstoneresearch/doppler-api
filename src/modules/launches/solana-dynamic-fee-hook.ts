import {
  address,
  getProgramDerivedAddress,
  type Address,
  type ProgramDerivedAddress,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { cosignerHook, initializer } from '@whetstone-research/doppler-sdk/solana';

const textEncoder = new TextEncoder();
const MAX_I64 = (1n << 63n) - 1n;
const MAX_U32 = (1n << 32n) - 1n;

export const DYNAMIC_FEE_HOOK_PROGRAM_ID: Address = address(
  'HVsPNZh98TgChUXHwKrUG47SUqvGQHxUy5wZwcQLFD4i',
);
export const SEED_DYNAMIC_FEE_HOOK_CONFIG = 'cosigner_hook_config';
export const DYNAMIC_FEE_SCHEDULE_MAGIC = new Uint8Array([
  0x44, 0x46, 0x45, 0x45, 0x56, 0x31, 0x5f, 0x5f,
]);
export const DYNAMIC_FEE_SCHEDULE_VERSION = 1;
export const DYNAMIC_FEE_SCHEDULE_LEN = 32;
export const DYNAMIC_FEE_SCHEDULE_HEADER_LEN = 16;
export const DYNAMIC_FEE_SCHEDULE_MAX_BPS = 10_000;

export type DynamicFeeScheduleArgs = {
  startingTime: bigint | number;
  startFeeBps: number;
  endFeeBps: number;
  durationSeconds: bigint | number;
};

export type DynamicFeeHookPayloadArgs = {
  schedule?: DynamicFeeScheduleArgs | null;
  gateExpiry?: Parameters<typeof cosignerHook.encodeCosignerGateExpiryPayload>[0] | null;
};

export type DynamicFeeHookRemainingAccounts = {
  unsignedHookRemainingAccounts: Address[];
  hookRemainingAccountsHash: Uint8Array;
};

const toBigInt = (value: bigint | number): bigint =>
  typeof value === 'bigint' ? value : BigInt(value);

const assertBps = (label: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > DYNAMIC_FEE_SCHEDULE_MAX_BPS) {
    throw new Error(`${label} must be an integer between 0 and 10000`);
  }
};

const writeI64Le = (bytes: Uint8Array, offset: number, value: bigint): void => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setBigInt64(offset, value, true);
};

const writeU16Le = (bytes: Uint8Array, offset: number, value: number): void => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(offset, value, true);
};

const writeU32Le = (bytes: Uint8Array, offset: number, value: bigint): void => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(offset, Number(value), true);
};

export const validateDynamicFeeScheduleArgs = (
  schedule: DynamicFeeScheduleArgs,
): { startingTime: bigint; durationSeconds: bigint } => {
  const startingTime = toBigInt(schedule.startingTime);
  if (startingTime < 0n || startingTime > MAX_I64) {
    throw new Error('startingTime must be between 0 and i64::MAX');
  }

  assertBps('startFeeBps', schedule.startFeeBps);
  assertBps('endFeeBps', schedule.endFeeBps);
  if (schedule.endFeeBps > schedule.startFeeBps) {
    throw new Error('endFeeBps must be less than or equal to startFeeBps');
  }

  const durationSeconds = toBigInt(schedule.durationSeconds);
  if (durationSeconds < 0n || durationSeconds > MAX_U32) {
    throw new Error('durationSeconds must be between 0 and u32::MAX');
  }
  if (schedule.startFeeBps > schedule.endFeeBps && durationSeconds === 0n) {
    throw new Error('durationSeconds must be nonzero for decaying schedules');
  }

  return { startingTime, durationSeconds };
};

export const encodeDynamicFeeSchedule = (schedule: DynamicFeeScheduleArgs): Uint8Array => {
  const { startingTime, durationSeconds } = validateDynamicFeeScheduleArgs(schedule);
  const payload = new Uint8Array(DYNAMIC_FEE_SCHEDULE_LEN);

  payload.set(DYNAMIC_FEE_SCHEDULE_MAGIC, 0);
  payload[8] = DYNAMIC_FEE_SCHEDULE_VERSION;
  writeI64Le(payload, DYNAMIC_FEE_SCHEDULE_HEADER_LEN, startingTime);
  writeU16Le(payload, 24, schedule.startFeeBps);
  writeU16Le(payload, 26, schedule.endFeeBps);
  writeU32Le(payload, 28, durationSeconds);

  return payload;
};

export const encodeDynamicFeeHookPayload = (args: DynamicFeeHookPayloadArgs = {}): Uint8Array => {
  const schedulePayload = args.schedule
    ? encodeDynamicFeeSchedule(args.schedule)
    : new Uint8Array();
  const gatePayload = args.gateExpiry
    ? cosignerHook.encodeCosignerGateExpiryPayload(args.gateExpiry)
    : new Uint8Array();

  const payload = new Uint8Array(schedulePayload.length + gatePayload.length);
  payload.set(schedulePayload, 0);
  payload.set(gatePayload, schedulePayload.length);
  return payload;
};

export const getDynamicFeeHookConfigAddress = (
  programId: Address = DYNAMIC_FEE_HOOK_PROGRAM_ID,
): Promise<ProgramDerivedAddress> =>
  getProgramDerivedAddress({
    programAddress: programId,
    seeds: [textEncoder.encode(SEED_DYNAMIC_FEE_HOOK_CONFIG)],
  });

export const getDynamicFeeHookRemainingAccounts = ({
  namespace,
  config,
  cosigner,
}: {
  namespace: Address;
  config?: Address;
  cosigner?: Address;
}): DynamicFeeHookRemainingAccounts => {
  const unsignedHookRemainingAccounts = [namespace];
  if (config && config !== namespace) {
    unsignedHookRemainingAccounts.push(config);
  }
  if (cosigner) {
    unsignedHookRemainingAccounts.push(cosigner);
  }

  return {
    unsignedHookRemainingAccounts,
    hookRemainingAccountsHash: initializer.computeRemainingAccountsHash(
      unsignedHookRemainingAccounts,
    ),
  };
};

export const isDynamicFeeSchedulePayload = (payload: ReadonlyUint8Array): boolean =>
  payload.length >= DYNAMIC_FEE_SCHEDULE_LEN &&
  DYNAMIC_FEE_SCHEDULE_MAGIC.every((byte, index) => payload[index] === byte);
