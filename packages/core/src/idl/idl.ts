import { BorshCoder, BorshEventCoder, BorshInstructionCoder, Idl, utils } from "@coral-xyz/anchor";
import { AnchorIdl, EventPayload, toMutableIdl } from "./idl-types";
import { LegacyIdl } from "./legacy-idl-types";
import { ExtractEventNames } from "../indexer/types/config.types";

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
  data: unknown;
};

export type DecodedEvent = {
  contract: string;
  name: string;
  type: "event";
  data: unknown;
};

export function getInstructionCoder(
  idl: AnchorIdl,
): BorshInstructionCoder {
  return new BorshCoder(toMutableIdl(idl)).instruction;
}

export function getEventCoder(idl: AnchorIdl): BorshEventCoder {
  return new BorshCoder(toMutableIdl(idl)).events;
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
  idl?: AnchorIdl,
): DecodedInstruction | null {
  if (!programId || !data || !idl) return null as never;

  const instructionCoder = getInstructionCoder(idl);

  if (instructionCoder) {
    const decoded = decodeInstructionParams(instructionCoder, data);

    if (decoded) {
      return {
        contract: programId,
        name: decoded.name,
        type: "instruction",
        data: decoded.data,
      };
    }
  }

  return null;
}

export const decodeEvent = (
  data: string,
  programId: string,
  idl?: AnchorIdl,
): DecodedEvent | null => {
  if (!idl) return null;
  const eventCoder = getEventCoder(idl);

  if (eventCoder) {
    const decoded = decodeEventData(eventCoder, data);

    if (decoded) {
      return {
        contract: programId,
        name: decoded.name,
        type: "event",
        data: decoded.data,
      };
    }
  }

  return null;
};

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

/**
 * Decode an event from base64-encoded log data (emit! macro format).
 * The emit! macro logs events via sol_log_data with format: "Program data: <base64>"
 * The base64 data contains: [8-byte discriminator][borsh-encoded event data]
 */
export function decodeEventFromLogData(
  base64Data: string,
  programId: string,
  idl?: AnchorIdl,
): DecodedEvent | null {
  if (!idl) return null;
  
  try {
    const eventCoder = getEventCoder(idl);
    if (!eventCoder) return null;

    // The log data is already base64 encoded and includes the discriminator
    const decoded = eventCoder.decode(base64Data);
    
    if (!decoded) return null;
    if (typeof decoded.name === "string") {
      return {
        contract: programId,
        name: decoded.name,
        type: "event",
        data: decoded.data,
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Parse events from transaction log messages.
 * Looks for "Program data:" entries which are emitted by Anchor's emit! macro.
 * 
 * Log format when emit! is used:
 * - "Program <program_id> invoke [depth]"
 * - ... other logs ...
 * - "Program data: <base64_encoded_event>"
 * - "Program <program_id> consumed X compute units"
 * - "Program <program_id> success"
 * 
 * Returns events and whether logs appear to be truncated.
 */
export function parseEventsFromLogs(
  logMessages: string[] | null | undefined,
  programIdls: Map<string, AnchorIdl>,
): { events: Array<{ programId: string; event: DecodedEvent }>; truncated: boolean } {
  const events: Array<{ programId: string; event: DecodedEvent }> = [];
  let truncated = false;
  
  if (!logMessages || logMessages.length === 0) {
    return { events, truncated };
  }

  // Track the current program context from invoke/success logs
  const programStack: string[] = [];
  
  for (const log of logMessages) {
    // Check for log truncation indicator
    if (log === "Log truncated") {
      truncated = true;
      continue;
    }
    
    // Track program invocations to know which program emitted the event
    const invokeMatch = log.match(/^Program (\w+) invoke \[\d+\]$/);
    if (invokeMatch && invokeMatch[1]) {
      programStack.push(invokeMatch[1]);
      continue;
    }
    
    const successMatch = log.match(/^Program (\w+) (success|failed)/);
    if (successMatch && successMatch[1]) {
      const completedProgram = successMatch[1];
      const lastIndex = programStack.lastIndexOf(completedProgram);
      if (lastIndex !== -1) {
        programStack.splice(lastIndex, 1);
      }
      continue;
    }
    
    const dataMatch = log.match(/^Program data: (.+)$/);
    if (dataMatch && dataMatch[1]) {
      const base64Data = dataMatch[1];
      const currentProgram = programStack[programStack.length - 1];
      
      if (currentProgram) {
        const idl = programIdls.get(currentProgram);
        if (idl) {
          const decoded = decodeEventFromLogData(base64Data, currentProgram, idl);
          if (decoded) {
            events.push({ programId: currentProgram, event: decoded });
          }
        }
      }
    }
  }
  
  return { events, truncated };
}
