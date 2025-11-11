import { utils, BorshCoder, Idl, BorshInstructionCoder, BorshEventCoder } from "@coral-xyz/anchor";
import type { LegacyIdl } from "./legacy-idl-types";

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
  parsed: any; // Generic parsed event data
};

export function getInstructionCoder(idl: any): BorshInstructionCoder {
  const coder = new BorshCoder(idl);
  return coder.instruction;
}

export function getEventCoder(idl: any): BorshEventCoder {
  const coder = new BorshCoder(idl);
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

export function decodeInstruction(data: string, programId: string, idl: Idl): DecodedInstruction | null {
  if (!programId || !data || !idl) return null;

  try {
    const instructionCoder = getInstructionCoder(idl);
    const decoded = decodeInstructionParams(instructionCoder, data);

    if (decoded) {
      return {
        contract: programId,
        name: decoded.name,
        type: "instruction",
        parsed: decoded.data,
      };
    }
  } catch (error) {
    console.warn(`Failed to decode instruction for program ${programId}:`, error);
  }

  return null;
}

export const decodeEvent = (data: string, programId: string, idl: Idl): DecodedEvent | null => {
  if (!programId || !data || !idl) return null;

  try {
    const eventCoder = getEventCoder(idl);
    const decoded = decodeEventData(eventCoder, data);

    if (decoded) {
      return {
        contract: programId, // Use programId directly
        name: decoded.name,
        type: "event",
        parsed: decoded.data,
      };
    }
  } catch (error) {
    console.warn(`Failed to decode event for program ${programId}:`, error);
  }

  return null;
}

// Legacy IDL detection and helper functions
export function isLegacyIdl(idl: any): idl is LegacyIdl {
  if (!idl || typeof idl !== "object") return false;
  
  // Check for legacy-specific fields
  const hasModernInstruction = idl.instructions?.some(
    (ix: any) => "discriminator" in ix 
  );
  
  return !(hasModernInstruction || "metadata" in idl || "address" in idl);
}

// Legacy IDL still uses same Borsh decoding, so existing functions work
// but we can add explicit legacy variants if needed
export function decodeLegacyInstruction(
  data: string,
  programId: string,
  idl: LegacyIdl
): DecodedInstruction | null {
  // Reuse existing decodeInstruction since Borsh encoding is the same
  return decodeInstruction(data, programId, idl as any);
}

export function decodeLegacyEvent(
  data: string,
  programId: string,
  idl: LegacyIdl
): DecodedEvent | null {
  // Reuse existing decodeEvent since Borsh encoding is the same
  return decodeEvent(data, programId, idl as any);
}
