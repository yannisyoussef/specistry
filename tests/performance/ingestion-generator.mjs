// Deterministic large-document generators shared by the fresh-process
// benchmark runner and the end-to-end CLI performance case. Documents are
// generated rather than committed so the repository never carries megabytes
// of repetition; the construction parameters below are the fixture identity.

/** `count` operations across `count / 2` paths, sharing 200 component schemas. */
export function operationsDocument(count) {
  const schemas = {};
  for (let index = 0; index < 200; index += 1) {
    schemas[`Model${index}`] = {
      properties: {
        id: { format: "int64", type: "integer" },
        name: { maxLength: 120, type: "string" },
        next: { $ref: `#/components/schemas/Model${(index + 1) % 200}` },
        tags: { items: { type: "string" }, type: "array", uniqueItems: true },
      },
      required: ["id"],
      type: "object",
    };
  }
  const paths = {};
  for (let index = 0; index < Math.ceil(count / 2); index += 1) {
    const schema = `#/components/schemas/Model${index % 200}`;
    paths[`/resources/${index}/{id}`] = {
      get: {
        operationId: `getResource${index}`,
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
          { in: "query", name: "expand", schema: { type: "boolean" } },
        ],
        responses: {
          200: {
            content: { "application/json": { schema: { $ref: schema } } },
            description: "ok",
          },
          404: { description: "missing" },
        },
        summary: `Read resource ${index}`,
        tags: [`group${index % 50}`],
      },
      post: {
        operationId: `updateResource${index}`,
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          content: { "application/json": { schema: { $ref: schema } } },
          required: true,
        },
        responses: { 204: { description: "updated" } },
        tags: [`group${index % 50}`],
      },
    };
  }
  return JSON.stringify({
    components: { schemas },
    info: { title: "Operations benchmark", version: "1.0.0" },
    openapi: "3.1.0",
    paths,
  });
}

/** Roughly `mebibytes` MiB of source through long operation descriptions. */
export function bytesDocument(mebibytes) {
  const description =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(70);
  const perOperation = description.length + 300;
  const count = Math.ceil((mebibytes * 1_048_576) / perOperation);
  const paths = {};
  for (let index = 0; index < count; index += 1) {
    paths[`/documents/${index}`] = {
      get: {
        description,
        operationId: `readDocument${index}`,
        responses: { 200: { description: "ok" } },
      },
    };
  }
  return JSON.stringify({
    info: { title: "Bytes benchmark", version: "1.0.0" },
    openapi: "3.1.0",
    paths,
  });
}

/** `count` minimal operations: one response each, no parameters or bodies. */
export function leanOperationsDocument(count) {
  const paths = {};
  for (let index = 0; index < count; index += 1) {
    paths[`/items/${index}`] = {
      get: {
        operationId: `getItem${index}`,
        responses: { 200: { description: "ok" } },
        tags: [`group${index % 50}`],
      },
    };
  }
  return JSON.stringify({
    info: { title: "Lean operations benchmark", version: "1.0.0" },
    openapi: "3.1.0",
    paths,
  });
}

/**
 * One object schema with `count` properties behind a single operation. The
 * mapping width is the workload: parsers that check key uniqueness by
 * scanning existing keys are quadratic here. `yaml: true` emits block YAML
 * so the YAML composer path is measured as well as the JSON one.
 */
export function wideSchemaDocument(count, yaml = false) {
  if (yaml) {
    const lines = [
      "openapi: 3.1.0",
      "info: { title: Wide benchmark, version: 1.0.0 }",
      "paths:",
      "  /wide:",
      "    get:",
      "      operationId: readWide",
      "      responses:",
      '        "200":',
      "          description: ok",
      "          content:",
      "            application/json:",
      "              schema: { $ref: '#/components/schemas/Wide' }",
      "components:",
      "  schemas:",
      "    Wide:",
      "      type: object",
      "      properties:",
    ];
    for (let index = 0; index < count; index += 1) {
      lines.push(`        p${index}: { type: string, maxLength: 64 }`);
    }
    return `${lines.join("\n")}\n`;
  }
  const properties = {};
  for (let index = 0; index < count; index += 1) {
    properties[`p${index}`] = { maxLength: 64, type: "string" };
  }
  return JSON.stringify({
    components: {
      schemas: { Wide: { properties, type: "object" } },
    },
    info: { title: "Wide benchmark", version: "1.0.0" },
    openapi: "3.1.0",
    paths: {
      "/wide": {
        get: {
          operationId: "readWide",
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Wide" },
                },
              },
              description: "ok",
            },
          },
        },
      },
    },
  });
}

/**
 * Node-dense document: `count` described properties of four nodes each, so
 * 120,000 properties is roughly 9 MiB and 480,000 nodes, inside every source
 * budget. Two of these are the multi-document memory workload.
 */
export function denseDocument(count) {
  const properties = {};
  for (let index = 0; index < count; index += 1) {
    properties[`p${index}`] = {
      description: `Property ${index}`,
      maxLength: 64,
      type: "string",
    };
  }
  return JSON.stringify({
    components: { schemas: { Dense: { properties, type: "object" } } },
    info: { title: "Dense benchmark", version: "1.0.0" },
    openapi: "3.1.0",
    paths: {
      "/dense": {
        get: {
          operationId: "readDense",
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Dense" },
                },
              },
              description: "ok",
            },
          },
        },
      },
    },
  });
}

/** One multipart request body with `count` encoded properties. */
export function encodingsDocument(count) {
  const properties = {};
  const encoding = {};
  for (let index = 0; index < count; index += 1) {
    properties[`field${index}`] = { type: "string" };
    encoding[`field${index}`] = { contentType: "text/plain" };
  }
  return JSON.stringify({
    info: { title: "Encodings benchmark", version: "1.0.0" },
    openapi: "3.1.0",
    paths: {
      "/upload": {
        post: {
          operationId: "upload",
          requestBody: {
            content: {
              "multipart/form-data": {
                encoding,
                schema: { properties, type: "object" },
              },
            },
          },
          responses: { 204: { description: "stored" } },
        },
      },
    },
  });
}

/**
 * `count` component schemas under one implicit-mapping discriminator, which
 * exercises component-name lookup per variant.
 */
export function polymorphicDocument(count) {
  const schemas = {};
  const oneOf = [];
  for (let index = 0; index < count; index += 1) {
    schemas[`Variant${index}`] = {
      properties: { kind: { type: "string" } },
      required: ["kind"],
      type: "object",
    };
    oneOf.push({ $ref: `#/components/schemas/Variant${index}` });
  }
  schemas.Shape = { discriminator: { propertyName: "kind" }, oneOf };
  return JSON.stringify({
    components: { schemas },
    info: { title: "Polymorphic benchmark", version: "1.0.0" },
    openapi: "3.1.0",
    paths: {
      "/shapes": {
        get: {
          operationId: "listShapes",
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Shape" },
                },
              },
              description: "ok",
            },
          },
        },
      },
    },
  });
}

export function generate(kind, scale) {
  if (kind === "bytes") return bytesDocument(scale);
  if (kind === "dense") return denseDocument(scale);
  if (kind === "encodings") return encodingsDocument(scale);
  if (kind === "lean") return leanOperationsDocument(scale);
  if (kind === "polymorphic") return polymorphicDocument(scale);
  if (kind === "wide") return wideSchemaDocument(scale);
  if (kind === "wide-yaml") return wideSchemaDocument(scale, true);
  return operationsDocument(scale);
}
