<?php

namespace App\Domain\Executions;

use App\Models\DestinationApproval;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\IpUtils;

class SafeTarget
{
    public function host(string $url, ?string $operatorApprovedHost = null): string
    {
        $p = parse_url($url);
        if (! $p || strlen($url) > 4096 || preg_match('/[\x00-\x20\x7f\\\\]/', $url)
            || ($p['scheme'] ?? '') !== 'https' || isset($p['user']) || isset($p['pass']) || isset($p['fragment'])
            || (isset($p['port']) && $p['port'] !== 443)) {
            throw ValidationException::withMessages(['url' => 'Use an approved HTTPS URL on port 443 without credentials or fragments.']);
        }
        $host = strtolower($p['host'] ?? '');
        $configured = in_array($host, config('apiforge.approved_hosts'), true);
        $approved = ! $configured && $operatorApprovedHost === null && DestinationApproval::where('hostname', $host)->where('status', 'approved')->exists();
        if (! preg_match('/^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/D', $host) || (! $configured && ! $approved && $operatorApprovedHost !== $host)) {
            throw ValidationException::withMessages(['url' => 'This destination is not approved by the operator.']);
        }

        return $host;
    }

    public function publicIp(string $ip): bool
    {
        if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return false;
        }
        if (str_contains($ip, ':')) {
            return IpUtils::checkIp($ip, '2000::/3') && ! IpUtils::checkIp($ip, ['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20']);
        }

        return ! IpUtils::checkIp($ip, ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4']);
    }

    public function resolve(string $host): string
    {
        $records = @dns_get_record($host, DNS_A | DNS_AAAA) ?: [];
        $ips = array_values(array_unique(array_filter(array_map(fn ($r) => $r['ip'] ?? $r['ipv6'] ?? null, $records))));
        if (! $ips) {
            throw ValidationException::withMessages(['url' => 'The approved destination could not be resolved.']);
        }
        foreach ($ips as $ip) {
            if (! $this->publicIp($ip)) {
                throw ValidationException::withMessages(['url' => 'Destination DNS includes a prohibited address.']);
            }
        }

        return $ips[0];
    }
}
