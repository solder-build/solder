import bs58 from "bs58";
import { BorshCoder, BorshEventCoder, BorshInstructionCoder, Idl, utils } from "@coral-xyz/anchor";
import { EventType, ExtractEvent, InstructionArgs } from "./idl-types";
import { ExtractEventNames } from "../indexer/indexer";

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
  parsed: unknown;
};

export type DecodedEvent = {
  contract: string;
  name: string;
  type: "event";
  parsed: unknown;
};

export function getInstructionCoder(
  idl: Idl,
): BorshInstructionCoder {
  return new BorshCoder(idl).instruction;
}

export function getEventCoder(idl: Idl): BorshEventCoder {
  return new BorshCoder(idl).events;
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
  idl: Idl,
): DecodedInstruction | null {
  if (!programId || !data) return null as never;

  const instructionCoder = getInstructionCoder(idl);

  if (instructionCoder) {
    const decoded = decodeInstructionParams(instructionCoder, data);

    if (decoded) {
      return {
        contract: programId,
        name: decoded.name,
        type: "instruction",
        parsed: decoded.data,
      };
    }
  }

  return null;
}

export const decodeEvent = (
  data: string,
  programId: string,
  idl: Idl,
): DecodedEvent | null => {
  const eventCoder = getEventCoder(idl);

  if (eventCoder) {
    const decoded = decodeEventData(eventCoder, data);

    if (decoded) {
      return {
        contract: programId,
        name: decoded.name,
        type: "event",
        parsed: decoded.data as EventType<
          Idl,
          ExtractEventNames<Idl>
        >,
      };
    }
  }

  return null;
};
