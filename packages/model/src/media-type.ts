const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Returns a deterministic RFC media-type spelling while preserving parameter values. */
export function canonicalizeMediaType(value: string): string | undefined {
  const parts = splitOutsideQuotes(value, ";");
  if (parts === undefined) return undefined;
  const essence = parts.shift()?.trim() ?? "";
  const slash = essence.indexOf("/");
  if (
    slash <= 0 ||
    slash !== essence.lastIndexOf("/") ||
    !TOKEN.test(essence.slice(0, slash)) ||
    !TOKEN.test(essence.slice(slash + 1))
  ) {
    return undefined;
  }
  const parameters: [string, string][] = [];
  const names = new Set<string>();
  for (const raw of parts) {
    const assignment = splitAssignment(raw);
    if (assignment === undefined) return undefined;
    const [rawName, rawValue] = assignment;
    const name = rawName.trim().toLowerCase();
    const parameterValue = rawValue.trim();
    if (
      !TOKEN.test(name) ||
      names.has(name) ||
      (!TOKEN.test(parameterValue) && !isQuotedString(parameterValue))
    ) {
      return undefined;
    }
    names.add(name);
    parameters.push([name, parameterValue]);
  }
  parameters.sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName < rightName
      ? -1
      : leftName > rightName
        ? 1
        : leftValue < rightValue
          ? -1
          : leftValue > rightValue
            ? 1
            : 0,
  );
  return `${essence.slice(0, slash).toLowerCase()}/${essence
    .slice(slash + 1)
    .toLowerCase()}${parameters
    .map(([name, parameterValue]) => `;${name}=${parameterValue}`)
    .join("")}`;
}

function splitOutsideQuotes(
  value: string,
  separator: string,
): string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) escaped = false;
    else if (quoted && character === "\\") escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === separator) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted || escaped) return undefined;
  parts.push(value.slice(start));
  return parts;
}

function splitAssignment(value: string): [string, string] | undefined {
  const parts = splitOutsideQuotes(value, "=");
  if (parts === undefined || parts.length < 2) return undefined;
  const name = parts.shift();
  if (name === undefined) return undefined;
  return [name, parts.join("=")];
}

function isQuotedString(value: string): boolean {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"'))
    return false;
  const inner = value.slice(1, -1);
  return !/[\p{Cc}]/u.test(inner) && !/(^|[^\\])(?:\\\\)*"/.test(inner);
}
