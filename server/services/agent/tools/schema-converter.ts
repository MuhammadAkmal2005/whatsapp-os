/**
 * Schema Converter: Zod to JSON Schema.
 *
 * Converts Zod schemas used in AITool definitions into standard JSON Schema
 * representations required by AI Provider function-calling contracts.
 */

import { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return convertZodType(schema);
}

function convertZodType(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, propSchema] of Object.entries(shape)) {
      const fieldSchema = propSchema as z.ZodTypeAny;
      properties[key] = convertZodType(fieldSchema);

      if (!isOptional(fieldSchema)) {
        required.push(key);
      }
    }

    const result: Record<string, unknown> = {
      type: 'object',
      properties,
    };
    if (required.length > 0) {
      result.required = required;
    }
    return result;
  }

  if (schema instanceof z.ZodString) {
    const res: Record<string, unknown> = { type: 'string' };
    if (schema.description) res.description = schema.description;
    return res;
  }

  if (schema instanceof z.ZodNumber) {
    const res: Record<string, unknown> = { type: 'number' };
    if (schema.description) res.description = schema.description;
    return res;
  }

  if (schema instanceof z.ZodBoolean) {
    const res: Record<string, unknown> = { type: 'boolean' };
    if (schema.description) res.description = schema.description;
    return res;
  }

  if (schema instanceof z.ZodEnum) {
    return {
      type: 'string',
      enum: schema._def.values,
    };
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: convertZodType(schema.element),
    };
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return convertZodType(schema.unwrap());
  }

  if (schema instanceof z.ZodDefault) {
    return convertZodType(schema._def.innerType);
  }

  // Fallback for any other Zod type
  return { type: 'string' };
}

function isOptional(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodOptional) return true;
  if (schema instanceof z.ZodDefault) return true;
  if (schema instanceof z.ZodNullable) return isOptional(schema.unwrap());
  return false;
}
