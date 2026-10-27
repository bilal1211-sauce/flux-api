# Offline OpenAPI schemas

Official schemas are vendored for deterministic validation without fetching user-supplied URLs:

- OpenAPI Initiative: https://spec.openapis.org/oas/3.0/schema/2024-10-18 and https://spec.openapis.org/oas/3.1/schema/2025-09-15, together with their OpenAPI dialect resources.
- JSON Schema: https://json-schema.org/draft/2020-12/schema and its referenced meta vocabularies.

The OpenAPI 3.0 Draft 4 schema is adapted to Draft 7 in memory (`id` and exclusive bounds). OpenAPI 3.1 uses the fixed OAS 2024-11-10 dialect; recursive meta references are bound explicitly to that dialect to avoid a nested dynamic-anchor resolution incompatibility in Opis. The vendored JSON files remain unmodified. Custom dialects, remote references and YAML aliases are outside the supported import profile. JSON/YAML size, node, depth and operation limits apply.

OpenAPI specification repository license: https://github.com/OAI/OpenAPI-Specification/blob/main/LICENSE (Apache-2.0). JSON Schema specification license: https://github.com/json-schema-org/json-schema-spec/blob/main/LICENSE (IETF Trust Simplified BSD / specification text terms). Font licenses ship with the installed `@fontsource/ibm-plex-*` packages (SIL Open Font License).
