import bs58 from "bs58";
import {
  BorshCoder,
  Idl,
  BorshInstructionCoder,
  BorshEventCoder,
} from "@project-serum/anchor";
import { utils } from "@coral-xyz/anchor";
import { EventType } from "./idl-types";

export type DecodedMeta = {
  contract: string;
  name: string;
  type: "instruction" | "event";
  params: unknown;
};

export type InstructionLike = {
  programId: string;
  data?: string;
  parsed?: unknown;
  meta?: DecodedMeta;
};

export type DecodedInstruction = {
  contract: string;
  name: string;
  type: "instruction";
  params: unknown;
};

export type DecodedEvent = {
  contract: string;
  name: string;
  type: "event";
  parsed: EventType<(typeof IDL_DATA_DICT)["PUMP_FUN"], "CreateEvent">;
};

const IDL_CONTRACT_ADDRESS_MAP: Record<string, string> = {
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "PUMP_FUN",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "RAYDIUM",
};

// Note: Large IDLs are embedded as JSON strings to avoid accidental mutation
const IDL_DATA_DICT = {
  PUMP_FUN: {
    version: "0.1.0",
    name: "pump",
    instructions: [
      {
        name: "initialize",
        docs: ["Creates the global state."],
        accounts: [
          { name: "global", isMut: true, isSigner: false },
          { name: "user", isMut: true, isSigner: true },
          { name: "systemProgram", isMut: false, isSigner: false },
        ],
        args: [],
      },
      {
        name: "setParams",
        docs: ["Sets the global state parameters."],
        accounts: [
          { name: "global", isMut: true, isSigner: false },
          { name: "user", isMut: true, isSigner: true },
          { name: "systemProgram", isMut: false, isSigner: false },
          { name: "eventAuthority", isMut: false, isSigner: false },
          { name: "program", isMut: false, isSigner: false },
        ],
        args: [
          { name: "feeRecipient", type: "publicKey" },
          { name: "initialVirtualTokenReserves", type: "u64" },
          { name: "initialVirtualSolReserves", type: "u64" },
          { name: "initialRealTokenReserves", type: "u64" },
          { name: "tokenTotalSupply", type: "u64" },
          { name: "feeBasisPoints", type: "u64" },
        ],
      },
      {
        name: "create",
        docs: ["Creates a new coin and bonding curve."],
        accounts: [
          { name: "mint", isMut: true, isSigner: true },
          { name: "mintAuthority", isMut: false, isSigner: false },
          { name: "bondingCurve", isMut: true, isSigner: false },
          { name: "associatedBondingCurve", isMut: true, isSigner: false },
          { name: "global", isMut: false, isSigner: false },
          { name: "mplTokenMetadata", isMut: false, isSigner: false },
          { name: "metadata", isMut: true, isSigner: false },
          { name: "user", isMut: true, isSigner: true },
          { name: "systemProgram", isMut: false, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "associatedTokenProgram", isMut: false, isSigner: false },
          { name: "rent", isMut: false, isSigner: false },
          { name: "eventAuthority", isMut: false, isSigner: false },
          { name: "program", isMut: false, isSigner: false },
        ],
        args: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "uri", type: "string" },
        ],
      },
      {
        name: "buy",
        docs: ["Buys tokens from a bonding curve."],
        accounts: [
          { name: "global", isMut: false, isSigner: false },
          { name: "feeRecipient", isMut: true, isSigner: false },
          { name: "mint", isMut: false, isSigner: false },
          { name: "bondingCurve", isMut: true, isSigner: false },
          { name: "associatedBondingCurve", isMut: true, isSigner: false },
          { name: "associatedUser", isMut: true, isSigner: false },
          { name: "user", isMut: true, isSigner: true },
          { name: "systemProgram", isMut: false, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "rent", isMut: false, isSigner: false },
          { name: "eventAuthority", isMut: false, isSigner: false },
          { name: "program", isMut: false, isSigner: false },
        ],
        args: [
          { name: "amount", type: "u64" },
          { name: "maxSolCost", type: "u64" },
        ],
      },
      {
        name: "sell",
        docs: ["Sells tokens into a bonding curve."],
        accounts: [
          { name: "global", isMut: false, isSigner: false },
          { name: "feeRecipient", isMut: true, isSigner: false },
          { name: "mint", isMut: false, isSigner: false },
          { name: "bondingCurve", isMut: true, isSigner: false },
          { name: "associatedBondingCurve", isMut: true, isSigner: false },
          { name: "associatedUser", isMut: true, isSigner: false },
          { name: "user", isMut: true, isSigner: true },
          { name: "systemProgram", isMut: false, isSigner: false },
          { name: "associatedTokenProgram", isMut: false, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "eventAuthority", isMut: false, isSigner: false },
          { name: "program", isMut: false, isSigner: false },
        ],
        args: [
          { name: "amount", type: "u64" },
          { name: "minSolOutput", type: "u64" },
        ],
      },
      {
        name: "withdraw",
        docs: [
          "Allows the admin to withdraw liquidity for a migration once the bonding curve completes",
        ],
        accounts: [
          { name: "global", isMut: false, isSigner: false },
          { name: "mint", isMut: false, isSigner: false },
          { name: "bondingCurve", isMut: true, isSigner: false },
          { name: "associatedBondingCurve", isMut: true, isSigner: false },
          { name: "associatedUser", isMut: true, isSigner: false },
          { name: "user", isMut: true, isSigner: true },
          { name: "systemProgram", isMut: false, isSigner: false },
          { name: "tokenProgram", isMut: false, isSigner: false },
          { name: "rent", isMut: false, isSigner: false },
          { name: "eventAuthority", isMut: false, isSigner: false },
          { name: "program", isMut: false, isSigner: false },
        ],
        args: [],
      },
    ],
    accounts: [
      {
        name: "Global",
        type: {
          kind: "struct",
          fields: [
            { name: "initialized", type: "bool" },
            { name: "authority", type: "publicKey" },
            { name: "feeRecipient", type: "publicKey" },
            { name: "initialVirtualTokenReserves", type: "u64" },
            { name: "initialVirtualSolReserves", type: "u64" },
            { name: "initialRealTokenReserves", type: "u64" },
            { name: "tokenTotalSupply", type: "u64" },
            { name: "feeBasisPoints", type: "u64" },
          ],
        },
      },
      {
        name: "BondingCurve",
        type: {
          kind: "struct",
          fields: [
            { name: "virtualTokenReserves", type: "u64" },
            { name: "virtualSolReserves", type: "u64" },
            { name: "realTokenReserves", type: "u64" },
            { name: "realSolReserves", type: "u64" },
            { name: "tokenTotalSupply", type: "u64" },
            { name: "complete", type: "bool" },
          ],
        },
      },
    ],
    events: [
      {
        name: "CreateEvent",
        fields: [
          { name: "name", type: "string", index: false },
          { name: "symbol", type: "string", index: false },
          { name: "uri", type: "string", index: false },
          { name: "mint", type: "publicKey", index: false },
          { name: "bondingCurve", type: "publicKey", index: false },
          { name: "user", type: "publicKey", index: false },
        ],
      },
      {
        name: "TradeEvent",
        fields: [
          { name: "mint", type: "publicKey", index: false },
          { name: "solAmount", type: "u64", index: false },
          { name: "tokenAmount", type: "u64", index: false },
          { name: "isBuy", type: "bool", index: false },
          { name: "user", type: "publicKey", index: false },
          { name: "timestamp", type: "i64", index: false },
          { name: "virtualSolReserves", type: "u64", index: false },
          { name: "virtualTokenReserves", type: "u64", index: false },
        ],
      },
      {
        name: "CompleteEvent",
        fields: [
          { name: "user", type: "publicKey", index: false },
          { name: "mint", type: "publicKey", index: false },
          { name: "bondingCurve", type: "publicKey", index: false },
          { name: "timestamp", type: "i64", index: false },
        ],
      },
      {
        name: "SetParamsEvent",
        fields: [
          { name: "feeRecipient", type: "publicKey", index: false },
          { name: "initialVirtualTokenReserves", type: "u64", index: false },
          { name: "initialVirtualSolReserves", type: "u64", index: false },
          { name: "initialRealTokenReserves", type: "u64", index: false },
          { name: "tokenTotalSupply", type: "u64", index: false },
          { name: "feeBasisPoints", type: "u64", index: false },
        ],
      },
    ],
    errors: [
      {
        code: 6000,
        name: "NotAuthorized",
        msg: "The given account is not authorized to execute this instruction.",
      },
      {
        code: 6001,
        name: "AlreadyInitialized",
        msg: "The program is already initialized.",
      },
      {
        code: 6002,
        name: "TooMuchSolRequired",
        msg: "slippage: Too much SOL required to buy the given amount of tokens.",
      },
      {
        code: 6003,
        name: "TooLittleSolReceived",
        msg: "slippage: Too little SOL received to sell the given amount of tokens.",
      },
      {
        code: 6004,
        name: "MintDoesNotMatchBondingCurve",
        msg: "The mint does not match the bonding curve.",
      },
      {
        code: 6005,
        name: "BondingCurveComplete",
        msg: "The bonding curve has completed and liquidity migrated to raydium.",
      },
      {
        code: 6006,
        name: "BondingCurveNotComplete",
        msg: "The bonding curve has not completed.",
      },
      {
        code: 6007,
        name: "NotInitialized",
        msg: "The program is not initialized.",
      },
    ],
    metadata: { address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" },
  } as const,
};

const INSTRUCTION_CODER_CLIENTS: Record<string, BorshInstructionCoder> = {};
const EVENT_CODER_CLIENTS: Record<string, BorshEventCoder> = {};

export function getInstructionCoder(
  programId: string,
): BorshInstructionCoder | null {
  const key = programId;
  if (INSTRUCTION_CODER_CLIENTS[key]) return INSTRUCTION_CODER_CLIENTS[key];
  const contract = IDL_CONTRACT_ADDRESS_MAP[key];
  if (!contract) return null;
  const json = IDL_DATA_DICT[contract as keyof typeof IDL_DATA_DICT];
  if (!json) return null;
  const idl: Idl = JSON.parse(json as unknown as string) as Idl;
  const coder = new BorshCoder(idl);
  return coder.instruction;
}

export function getEventCoder(programId: string): BorshEventCoder | null {
  const key = programId;
  if (EVENT_CODER_CLIENTS[key]) return EVENT_CODER_CLIENTS[key];
  const contract = IDL_CONTRACT_ADDRESS_MAP[key];
  if (!contract) return null;
  const json = IDL_DATA_DICT[contract as keyof typeof IDL_DATA_DICT];
  if (!json) return null;
  // const idl: Idl = JSON.parse(json) as Idl;
  const coder = new BorshCoder(json as unknown as Idl);
  return coder.events;
}

export function decodeInstructionParams(
  instructionCoder: BorshInstructionCoder,
  base58Data: string,
): {
  name: string;
  data: unknown;
} {
  try {
    const decoded = instructionCoder.decode(base58Data, "base58");

    if (!decoded?.name) return null as never;

    return decoded;
  } catch (e) {
    return null as never;
  }
}

export function decodeEventData(
  eventCoder: BorshEventCoder,
  base58Data: string,
): { name: string; data: unknown } | null {
  try {
    const ixData = utils.bytes.bs58.decode(base58Data);
    const eventData = utils.bytes.base64.encode(
      Buffer.from(new Uint8Array(ixData).slice(8)),
    );

    const decoded = eventCoder.decode(eventData);

    if (!decoded) return null;
    if (typeof decoded.name === "string") {
      return { name: decoded.name, data: decoded.data };
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function decodeInstruction(
  data: string,
  programId: string,
): DecodedInstruction | null {
  if (!programId || !data) return null as never;

  const instructionCoder = getInstructionCoder(programId);

  if (instructionCoder) {
    const decoded = decodeInstructionParams(instructionCoder, data);

    if (decoded) {
      return {
        contract: IDL_CONTRACT_ADDRESS_MAP[
          programId as keyof typeof IDL_CONTRACT_ADDRESS_MAP
        ] as string,
        name: "instruction",
        type: "instruction",
        params: decoded,
      };
    }
  }

  return null;
}

export const decodeEvent = (
  data: string,
  programId: string,
): DecodedEvent | null => {
  const eventCoder = getEventCoder(programId);

  if (eventCoder) {
    const decoded = decodeEventData(eventCoder, data);

    if (decoded) {
      return {
        contract: IDL_CONTRACT_ADDRESS_MAP[
          programId as keyof typeof IDL_CONTRACT_ADDRESS_MAP
        ] as string,
        name: decoded.name,
        type: "event",
        parsed: decoded.data as EventType<
          (typeof IDL_DATA_DICT)["PUMP_FUN"],
          "CreateEvent"
        >,
      };
    }
  }

  return null;
};
