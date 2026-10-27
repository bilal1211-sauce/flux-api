<?php

use App\Domain\Executions\CurlTransport;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Validation\ValidationException;

// Private, token-protected service. No database credentials or application key are needed in production.
require __DIR__.'/../../api/vendor/autoload.php';
$app = require __DIR__.'/../../api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
header('Content-Type: application/json');
header('Cache-Control: no-store');
$expected = config('apiforge.executor_token');
if (! $expected || ! hash_equals('Bearer '.$expected, $_SERVER['HTTP_AUTHORIZATION'] ?? '')) {
    http_response_code(401);
    echo json_encode(['message' => 'Unauthorized.']);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) !== '/run') {
    http_response_code(404);
    echo json_encode(['message' => 'Not found.']);
    exit;
}
$input = file_get_contents('php://input', false, null, 0, 524289);
if (strlen($input) > 524288) {
    http_response_code(413);
    echo json_encode(['message' => 'Payload too large.']);
    exit;
}
try {
    $data = json_decode($input, true, 32, JSON_THROW_ON_ERROR);
    if (! is_array($data) || ! in_array($data['method'] ?? '', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], true)
        || ! is_string($data['url'] ?? null) || ! is_array($data['headers'] ?? null) || count($data['headers']) > 40
        || ! is_int($data['timeout_ms'] ?? null) || $data['timeout_ms'] < 100 || $data['timeout_ms'] > 15000
        || ! is_string($data['body_base64'] ?? null) || ! preg_match('/^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/D', $data['body_base64'])) {
        throw new InvalidArgumentException;
    }
    $body = base64_decode($data['body_base64'], true);
    if ($body === false || strlen($body) > 131072) {
        throw new InvalidArgumentException;
    }
    foreach ($data['headers'] as $k => $v) {
        if (! is_string($k) || ! is_string($v) || strlen($v) > 16384) {
            throw new InvalidArgumentException;
        }
    }
    $approvedHost = $data['approved_host'] ?? '';
    $approvedAt = $data['approved_at'] ?? 0;
    $signature = $data['approval_signature'] ?? '';
    if (! is_string($approvedHost) || ! is_int($approvedAt) || ! is_string($signature)) {
        throw new InvalidArgumentException;
    }
    $requestHost = strtolower((string) parse_url($data['url'], PHP_URL_HOST));
    $expectedSignature = hash_hmac('sha256', $approvedHost."\n".$approvedAt, $expected);
    if (! preg_match('/^(?=.{1,253}$)[a-z0-9.-]+$/D', $approvedHost)
        || $requestHost !== $approvedHost || ! is_int($approvedAt) || abs(time() - $approvedAt) > 30
        || ! hash_equals($expectedSignature, $signature)) {
        throw new InvalidArgumentException;
    }
    $response = (new CurlTransport)->send($data['method'], $data['url'], $data['headers'], $body, $data['timeout_ms'], $approvedHost);
    echo json_encode(['data' => $response], JSON_INVALID_UTF8_SUBSTITUTE);
} catch (ValidationException|JsonException|InvalidArgumentException $e) {
    http_response_code(422);
    echo json_encode(['message' => 'Request rejected by the restricted executor.']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['message' => 'Executor failed.']);
}
