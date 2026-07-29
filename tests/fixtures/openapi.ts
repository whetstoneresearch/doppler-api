import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const openApiPath = resolve(__dirname, '../../docs/openapi.yaml');

const extractFlowMapping = (source: string, startIndex: number): string => {
  const mappingStart = source.indexOf('{', startIndex);
  if (mappingStart === -1) {
    throw new Error('OpenAPI example is not a flow mapping');
  }

  let depth = 0;
  let inString = false;
  for (let index = mappingStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") {
      if (inString && source[index + 1] === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(mappingStart, index + 1);
      }
    }
  }

  throw new Error('OpenAPI example flow mapping is unterminated');
};

const flowYamlToJson = (source: string): string => {
  let output = '';
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "'") {
      output += source[index];
      continue;
    }

    let value = '';
    index += 1;
    while (index < source.length) {
      if (source[index] !== "'") {
        value += source[index];
        index += 1;
        continue;
      }
      if (source[index + 1] === "'") {
        value += "'";
        index += 2;
        continue;
      }
      break;
    }
    output += JSON.stringify(value);
  }
  return output.replace(/,\s*([}\]])/g, '$1');
};

export const readOpenApiExample = (name: string): unknown => {
  const openApi = readFileSync(openApiPath, 'utf8');
  const schemaStart = openApi.indexOf(`    ${name}:\n`);
  if (schemaStart === -1) {
    throw new Error(`Missing OpenAPI schema ${name}`);
  }
  const exampleStart = openApi.indexOf('      example:', schemaStart);
  if (exampleStart === -1) {
    throw new Error(`Missing OpenAPI example for ${name}`);
  }
  const followingSource = openApi.slice(schemaStart + name.length + 6);
  const nextSchemaOffset = followingSource.search(/^    [A-Za-z][A-Za-z0-9]+:\n/m);
  const nextSchema =
    nextSchemaOffset === -1 ? -1 : schemaStart + name.length + 6 + nextSchemaOffset;
  if (nextSchema !== -1 && exampleStart > nextSchema) {
    throw new Error(`Missing OpenAPI example for ${name}`);
  }

  return JSON.parse(flowYamlToJson(extractFlowMapping(openApi, exampleStart)));
};

export const readOpenApiPattern = (name: string): string => {
  const openApi = readFileSync(openApiPath, 'utf8');
  const schemaStart = openApi.indexOf(`    ${name}:\n`);
  if (schemaStart === -1) {
    throw new Error(`Missing OpenAPI schema ${name}`);
  }

  const followingSource = openApi.slice(schemaStart + name.length + 6);
  const nextSchemaOffset = followingSource.search(/^    [A-Za-z][A-Za-z0-9]+:\n/m);
  const schemaSource =
    nextSchemaOffset === -1 ? followingSource : followingSource.slice(0, nextSchemaOffset);
  const pattern = schemaSource.match(/^      pattern: '([^']+)'$/m)?.[1];
  if (!pattern) {
    throw new Error(`Missing direct OpenAPI pattern for ${name}`);
  }
  return pattern;
};
