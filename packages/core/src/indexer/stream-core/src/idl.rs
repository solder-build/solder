use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{anyhow, bail, Context, Result};
use anchor_lang_idl::convert::convert_idl;
use anchor_lang_idl_spec::{Idl, IdlDefinedFields, IdlField, IdlInstruction, IdlType, IdlTypeDefTy};
use borsh::BorshDeserialize;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub struct IdlConfig {
    pub program_id: String,
    pub idl_path: Option<PathBuf>,
    pub idl_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct IdlRegistry {
    idls: HashMap<String, Idl>,
    instruction_decoders: HashMap<String, InstructionDecoder>,
    event_decoders: HashMap<String, EventDecoder>,
}

impl Default for IdlRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl IdlRegistry {
    pub fn new() -> Self {
        Self {
            idls: HashMap::new(),
            instruction_decoders: HashMap::new(),
            event_decoders: HashMap::new(),
        }
    }

    pub fn load_from_file(&mut self, program_id: &str, path: &PathBuf) -> Result<()> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("reading IDL {}", path.display()))?;
        self.load_from_str(program_id, &content)
    }

    #[allow(dead_code)]
    pub fn get_idl(&self, program_id: &str) -> Option<&Idl> {
        self.idls.get(program_id)
    }

    pub fn load_from_str(&mut self, program_id: &str, idl_json: &str) -> Result<()> {
        let idl = match convert_idl(idl_json.as_bytes()) {
            Ok(converted) => converted,
            Err(convert_err) => match serde_json::from_str::<Idl>(idl_json) {
                Ok(parsed) => parsed,
                Err(parse_err) => {
                    return Err(anyhow!(
                        "failed to parse IDL (convert error: {convert_err}; serde error: {parse_err})"
                    ));
                }
            },
        };
        let instruction_decoder = InstructionDecoder::from_idl(&idl);
        let event_decoder = EventDecoder::from_idl(&idl);
        self.idls.insert(program_id.to_string(), idl);
        self.instruction_decoders
            .insert(program_id.to_string(), instruction_decoder);
        self.event_decoders
            .insert(program_id.to_string(), event_decoder);
        Ok(())
    }

    pub fn get_instruction_decoder(&self, program_id: &str) -> Option<&InstructionDecoder> {
        self.instruction_decoders.get(program_id)
    }

    pub fn get_event_decoder(&self, program_id: &str) -> Option<&EventDecoder> {
        self.event_decoders.get(program_id)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DecodedInstruction {
    pub name: String,
    pub parsed: JsonValue,
}

#[derive(Debug, Clone)]
pub struct InstructionDecoder {
    by_discriminator: HashMap<[u8; 8], IdlInstruction>,
    idl: Idl,
}

impl InstructionDecoder {
    pub fn from_idl(idl: &Idl) -> Self {
        let mut by_discriminator = HashMap::new();
        for ix in &idl.instructions {
            // IDL spec 0.1 already includes the discriminator
            if ix.discriminator.len() >= 8 {
                let mut disc = [0u8; 8];
                disc.copy_from_slice(&ix.discriminator[..8]);
                by_discriminator.insert(disc, ix.clone());
            }
        }
        Self {
            by_discriminator,
            idl: idl.clone(),
        }
    }

    pub fn decode(&self, data: &[u8]) -> Result<DecodedInstruction> {
        if data.len() < 8 {
            bail!("instruction data too short (need at least 8 bytes for discriminator)");
        }

        let mut disc = [0u8; 8];
        disc.copy_from_slice(&data[..8]);

        let instruction = self
            .by_discriminator
            .get(&disc)
            .ok_or_else(|| anyhow!("unknown instruction discriminator: {:?}", disc))?;

        let name = instruction.name.clone();
        let params_data = &data[8..];

        let reader = IdlReader::new(&self.idl);
        let params = reader.parse_fields(params_data, &instruction.args)?;

        Ok(DecodedInstruction { name, parsed: params })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DecodedEvent {
    pub name: String,
    pub parsed: JsonValue,
}

#[derive(Debug, Clone)]
pub struct EventDecoder {
    by_discriminator: HashMap<[u8; 8], (String, Vec<IdlField>)>,
    idl: Idl,
}

impl EventDecoder {
    pub fn from_idl(idl: &Idl) -> Self {
        let mut by_discriminator = HashMap::new();
        
        for event in &idl.events {
            // IDL spec 0.1 includes discriminator
            if event.discriminator.len() >= 8 {
                let mut disc = [0u8; 8];
                disc.copy_from_slice(&event.discriminator[..8]);
                
                // Look up the type definition for the event
                let fields = idl
                    .types
                    .iter()
                    .find(|t| t.name == event.name)
                    .and_then(|t| match &t.ty {
                        IdlTypeDefTy::Struct { fields } => fields.as_ref().and_then(|f| match f {
                            IdlDefinedFields::Named(fields) => Some(fields.clone()),
                            _ => None,
                        }),
                        _ => None,
                    })
                    .unwrap_or_default();
                
                by_discriminator.insert(disc, (event.name.clone(), fields));
            }
        }
        
        Self {
            by_discriminator,
            idl: idl.clone(),
        }
    }

    pub fn decode_from_instruction_data(&self, instruction_data: &[u8]) -> Result<Vec<DecodedEvent>> {
        let mut events = Vec::new();

        if instruction_data.len() < 8 {
            return Ok(events);
        }

        let mut disc = [0u8; 8];
        disc.copy_from_slice(&instruction_data[..8]);
        
        if let Some((name, fields)) = self.by_discriminator.get(&disc) {
            let event_data = &instruction_data[8..];
            let reader = IdlReader::new(&self.idl);
            
            match reader.parse_fields(event_data, fields) {
                Ok(parsed) => {
                    events.push(DecodedEvent {
                        name: name.clone(),
                        parsed,
                    });
                    return Ok(events);
                }
                Err(e) => {
                    eprintln!("Failed to decode standalone event {}: {:?}", name, e);
                }
            }
        }

        if instruction_data.len() >= 16 {
            let mut disc = [0u8; 8];
            disc.copy_from_slice(&instruction_data[8..16]);
            
            if let Some((name, fields)) = self.by_discriminator.get(&disc) {
                let event_data = &instruction_data[16..];
                let reader = IdlReader::new(&self.idl);
                
                match reader.parse_fields(event_data, fields) {
                    Ok(parsed) => {
                        events.push(DecodedEvent {
                            name: name.clone(),
                            parsed,
                        });
                    }
                    Err(e) => {
                        eprintln!("Failed to decode embedded event {}: {:?}", name, e);
                    }
                }
            }
        }

        Ok(events)
    }
}

struct IdlReader<'a> {
    idl: &'a Idl,
}

impl<'a> IdlReader<'a> {
    fn new(idl: &'a Idl) -> Self {
        Self { idl }
    }

    fn parse_fields(&self, data: &[u8], fields: &[IdlField]) -> Result<JsonValue> {
        let mut result = serde_json::Map::new();
        let mut cursor = data;

        for field in fields {
            let value = self.parse_value(&mut cursor, &field.ty)
                .with_context(|| format!("parsing field {}", field.name))?;
            result.insert(field.name.clone(), value);
        }

        Ok(JsonValue::Object(result))
    }

    fn parse_value(&self, data: &mut &[u8], ty: &IdlType) -> Result<JsonValue> {
        Ok(match ty {
            IdlType::Bool => {
                let value: bool = BorshDeserialize::deserialize(data)?;
                JsonValue::Bool(value)
            }
            
            IdlType::U8 => {
                let value: u8 = BorshDeserialize::deserialize(data)?;
                JsonValue::Number(value.into())
            }
            IdlType::U16 => {
                let value: u16 = BorshDeserialize::deserialize(data)?;
                JsonValue::Number(value.into())
            }
            IdlType::U32 => {
                let value: u32 = BorshDeserialize::deserialize(data)?;
                JsonValue::Number(value.into())
            }
            IdlType::U64 => {
                let value: u64 = BorshDeserialize::deserialize(data)?;
                JsonValue::String(value.to_string())
            }
            IdlType::U128 => {
                let value: u128 = BorshDeserialize::deserialize(data)?;
                JsonValue::String(value.to_string())
            }
            IdlType::U256 => {
                let bytes: [u8; 32] = BorshDeserialize::deserialize(data)?;
                JsonValue::String(bs58::encode(&bytes).into_string())
            }
            
            IdlType::I8 => {
                let value: i8 = BorshDeserialize::deserialize(data)?;
                JsonValue::Number(value.into())
            }
            IdlType::I16 => {
                let value: i16 = BorshDeserialize::deserialize(data)?;
                JsonValue::Number(value.into())
            }
            IdlType::I32 => {
                let value: i32 = BorshDeserialize::deserialize(data)?;
                JsonValue::Number(value.into())
            }
            IdlType::I64 => {
                let value: i64 = BorshDeserialize::deserialize(data)?;
                JsonValue::String(value.to_string())
            }
            IdlType::I128 => {
                let value: i128 = BorshDeserialize::deserialize(data)?;
                JsonValue::String(value.to_string())
            }
            IdlType::I256 => {
                let bytes: [u8; 32] = BorshDeserialize::deserialize(data)?;
                JsonValue::String(bs58::encode(&bytes).into_string())
            }
            
            IdlType::F32 => {
                let value: f32 = BorshDeserialize::deserialize(data)?;
                serde_json::Number::from_f64(value as f64)
                    .map(JsonValue::Number)
                    .unwrap_or(JsonValue::Null)
            }
            IdlType::F64 => {
                let value: f64 = BorshDeserialize::deserialize(data)?;
                serde_json::Number::from_f64(value)
                    .map(JsonValue::Number)
                    .unwrap_or(JsonValue::Null)
            }
            
            IdlType::Bytes => {
                let bytes: Vec<u8> = BorshDeserialize::deserialize(data)?;
                JsonValue::String(bs58::encode(&bytes).into_string())
            }
            
            IdlType::String => {
                let value: String = BorshDeserialize::deserialize(data)?;
                JsonValue::String(value)
            }
            
            IdlType::Pubkey => {
                let bytes: [u8; 32] = BorshDeserialize::deserialize(data)?;
                JsonValue::String(bs58::encode(&bytes).into_string())
            }
            
            IdlType::Option(inner_ty) => {
                let has_value: u8 = BorshDeserialize::deserialize(data)?;
                if has_value == 0 {
                    JsonValue::Null
                } else {
                    self.parse_value(data, inner_ty)?
                }
            }
            
            IdlType::Vec(inner_ty) => {
                let len: u32 = BorshDeserialize::deserialize(data)?;
                let mut arr = Vec::with_capacity(len as usize);
                for _ in 0..len {
                    arr.push(self.parse_value(data, inner_ty)?);
                }
                JsonValue::Array(arr)
            }
            
            IdlType::Array(inner_ty, array_len) => {
                let len = match array_len {
                    anchor_lang_idl_spec::IdlArrayLen::Value(v) => *v,
                    anchor_lang_idl_spec::IdlArrayLen::Generic(_) => {
                        bail!("generic array lengths not supported");
                    }
                };
                let mut arr = Vec::with_capacity(len);
                for _ in 0..len {
                    arr.push(self.parse_value(data, inner_ty)?);
                }
                JsonValue::Array(arr)
            }
            
            IdlType::Defined { name, generics } => {
                if !generics.is_empty() {
                    bail!("generic types not yet supported");
                }
                
                let type_def = self
                    .idl
                    .types
                    .iter()
                    .find(|t| t.name == *name)
                    .ok_or_else(|| anyhow!("type not found in IDL: {}", name))?;

                match &type_def.ty {
                    IdlTypeDefTy::Struct { fields } => {
                        match fields {
                            Some(IdlDefinedFields::Named(fields)) => self.parse_fields(data, fields)?,
                            Some(IdlDefinedFields::Tuple(_)) => bail!("tuple structs not yet supported"),
                            None => JsonValue::Object(serde_json::Map::new()),
                        }
                    }
                    
                    IdlTypeDefTy::Enum { variants } => {
                        let discriminant: u8 = BorshDeserialize::deserialize(data)?;
                        let variant = variants
                            .get(discriminant as usize)
                            .ok_or_else(|| anyhow!("invalid enum discriminant: {}", discriminant))?;

                        match &variant.fields {
                            None => {
                                JsonValue::Object({
                                    let mut map = serde_json::Map::new();
                                    map.insert(variant.name.clone(), JsonValue::Null);
                                    map
                                })
                            }
                            Some(IdlDefinedFields::Named(fields)) => {
                                let parsed = self.parse_fields(data, fields)?;
                                JsonValue::Object({
                                    let mut map = serde_json::Map::new();
                                    map.insert(variant.name.clone(), parsed);
                                    map
                                })
                            }
                            Some(IdlDefinedFields::Tuple(types)) => {
                                let mut values = Vec::new();
                                for ty in types {
                                    values.push(self.parse_value(data, ty)?);
                                }
                                JsonValue::Object({
                                    let mut map = serde_json::Map::new();
                                    map.insert(variant.name.clone(), JsonValue::Array(values));
                                    map
                                })
                            }
                        }
                    }
                    
                    IdlTypeDefTy::Type { alias } => {
                        self.parse_value(data, alias)?
                    }
                }
            }
            
            IdlType::Generic(_) => {
                bail!("generic types not supported");
            }
            
            _ => {
                bail!("unsupported IDL type");
            }
        })
    }
}
