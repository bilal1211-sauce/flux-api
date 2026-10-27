<?php

namespace App\Domain\Requests;

use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Opis\JsonSchema\CompliantValidator;
use Symfony\Component\Yaml\Yaml;

class OpenApiDocument
{
    public function parse(Request $request): array
    {
        $request->validate(['document' => 'sometimes|required|string|max:450000', 'spec' => 'required_without:document|array']);
        try {
            if ($request->has('document')) {
                $text = $request->string('document')->toString();
                if (preg_match('/(^|[\s\[,])(?:[&*][A-Za-z0-9_-]+|<<\s*:)/m', $text)) {
                    $this->invalid('YAML anchors and aliases must be expanded before importing.');
                }
                $document = str_starts_with(ltrim($text), '{') ? json_decode($text, false, 64, JSON_THROW_ON_ERROR) : Yaml::parse($text, Yaml::PARSE_OBJECT_FOR_MAP | Yaml::PARSE_EXCEPTION_ON_INVALID_TYPE);
            } else {
                $document = json_decode($request->getContent(), false, 64, JSON_THROW_ON_ERROR)->spec;
            }
        } catch (ValidationException $exception) {
            throw $exception;
        } catch (\Throwable $exception) {
            $this->invalid('The document is not valid JSON or YAML.');
        }
        if (! is_object($document) || ! is_string($document->openapi ?? null) || ! preg_match('/^3\.[01]\.\d+$/', $document->openapi)) {
            $this->invalid('Use an OpenAPI 3.0 or 3.1 document.');
        }
        $nodes = 0;
        $this->inspect($document, $document, 0, $nodes);
        $validator = new CompliantValidator;
        foreach (glob(resource_path('schemas/*.json')) as $path) {
            // This importer fixes the OpenAPI dialect; bind recursive meta references explicitly.
            $source = preg_replace('/"\$dynamicRef"\s*:\s*"#meta"/', '"$ref":"https://spec.openapis.org/oas/3.1/dialect/2024-11-10"', file_get_contents($path));
            $schema = json_decode($source);
            if (str_ends_with($path, 'openapi-3.0.json')) {
                $schema = $this->draftSeven($schema);
                $schema->{'$id'} = $schema->id;
                unset($schema->id);
                $schema->{'$schema'} = 'http://json-schema.org/draft-07/schema#';
            }
            $validator->resolver()->registerRaw($schema, $schema->{'$id'});
        }
        $schemaId = str_starts_with($document->openapi, '3.0.') ? 'https://spec.openapis.org/oas/3.0/schema/2024-10-18' : 'https://spec.openapis.org/oas/3.1/schema/2025-09-15';
        try {
            $result = $validator->validate($document, $schemaId);
        } catch (\Throwable $exception) {
            $this->invalid('The document contains an invalid schema or an unsupported schema dialect.');
        }
        if (! $result->isValid()) {
            $this->invalid('The document does not match the OpenAPI '.$document->openapi.' schema. Check required fields, operation responses and component schemas.');
        }
        $data = json_decode(json_encode($document, JSON_THROW_ON_ERROR), true, 64, JSON_THROW_ON_ERROR);
        if (count($data['paths'] ?? []) > 100 || mb_strlen($data['info']['title']) > 150) {
            $this->invalid('Use at most 100 paths and a title of at most 150 characters.');
        }

        return $data;
    }

    public function resolve(array $node, array $document, array $seen = []): array
    {
        if (! isset($node['$ref'])) {
            return $node;
        }
        $ref = $node['$ref'];
        if (isset($seen[$ref]) || count($seen) >= 25) {
            $this->invalid('A reference used by an operation is circular.');
        }
        $seen[$ref] = true;
        $value = $document;
        foreach (explode('/', substr($ref, 2)) as $segment) {
            $key = str_replace(['~1', '~0'], ['/', '~'], rawurldecode($segment));
            if (! is_array($value) || ! array_key_exists($key, $value)) {
                $this->invalid('A local reference does not exist.');
            }
            $value = $value[$key];
        }
        if (! is_array($value)) {
            $this->invalid('An operation reference must point to an object.');
        }

        return $this->resolve($value, $document, $seen);
    }

    private function inspect(mixed $node, object $root, int $depth, int &$nodes): void
    {
        if (++$nodes > 20000 || $depth > 40) {
            $this->invalid('The document is too complex to import.');
        }
        if (is_object($node)) {
            foreach (['$schema', 'jsonSchemaDialect'] as $key) {
                if (isset($node->{$key}) && ! in_array($node->{$key}, ['https://spec.openapis.org/oas/3.1/dialect/base', 'https://spec.openapis.org/oas/3.1/dialect/2024-11-10', 'https://json-schema.org/draft/2020-12/schema'], true)) {
                    $this->invalid('Custom schema dialects must be converted to the OpenAPI 3.1 dialect first.');
                }
            }
            if (isset($node->{'$dynamicRef'}) && (! is_string($node->{'$dynamicRef'}) || ! str_starts_with($node->{'$dynamicRef'}, '#'))) {
                $this->invalid('External dynamic references are not allowed.');
            }
        }
        if (is_object($node) && isset($node->{'$ref'})) {
            $ref = $node->{'$ref'};
            if (! is_string($ref) || ! str_starts_with($ref, '#/')) {
                $this->invalid('Only local #/ references are allowed. External references are never fetched.');
            }
            $value = $root;
            foreach (explode('/', substr($ref, 2)) as $segment) {
                $key = str_replace(['~1', '~0'], ['/', '~'], rawurldecode($segment));
                if (is_object($value) && property_exists($value, $key)) {
                    $value = $value->{$key};
                } elseif (is_array($value) && array_key_exists($key, $value)) {
                    $value = $value[$key];
                } else {
                    $this->invalid('A local reference does not exist.');
                }
            }
        }
        if (is_array($node) || is_object($node)) {
            foreach ($node as $value) {
                $this->inspect($value, $root, $depth + 1, $nodes);
            }
        }
    }

    private function draftSeven(mixed $node): mixed
    {
        if (is_object($node)) {
            foreach (['Minimum' => 'minimum', 'Maximum' => 'maximum'] as $suffix => $bound) {
                $key = 'exclusive'.$suffix;
                if (isset($node->{$key}) && is_bool($node->{$key})) {
                    if ($node->{$key} && isset($node->{$bound})) {
                        $node->{$key} = $node->{$bound};
                        unset($node->{$bound});
                    } else {
                        unset($node->{$key});
                    }
                }
            }
            foreach ($node as $key => $value) {
                $node->{$key} = $this->draftSeven($value);
            }
        } elseif (is_array($node)) {
            foreach ($node as $key => $value) {
                $node[$key] = $this->draftSeven($value);
            }
        }

        return $node;
    }

    private function invalid(string $message): never
    {
        throw ValidationException::withMessages(['spec' => $message]);
    }
}
