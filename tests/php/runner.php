<?php
/**
 * Minimal test runner — no PHPUnit dependency.
 * Usage: php tests/php/runner.php
 */

$passed = 0; $failed = 0; $skipped = 0;
$failures = [];

function test(string $name, callable $fn): void {
    global $passed, $failed, $failures;
    try {
        $fn();
        echo "  \033[32m✓\033[0m  $name\n";
        $passed++;
    } catch (Throwable $e) {
        echo "  \033[31m✗\033[0m  $name\n    → {$e->getMessage()}\n";
        $failed++;
        $failures[] = "$name: " . $e->getMessage();
    }
}

function describe(string $suite, callable $fn): void {
    echo "\n\033[1m$suite\033[0m\n";
    $fn();
}

function expect($actual): object {
    return new class($actual) {
        public function __construct(private mixed $val) {}

        public function toBe(mixed $expected): void {
            if ($this->val !== $expected) {
                throw new \RuntimeException("Expected " . json_encode($expected) . ", got " . json_encode($this->val));
            }
        }

        public function toEqual(mixed $expected): void {
            if ($this->val != $expected) {
                throw new \RuntimeException("Expected " . json_encode($expected) . ", got " . json_encode($this->val));
            }
        }

        public function toContain(string $needle): void {
            if (!str_contains((string)$this->val, $needle)) {
                throw new \RuntimeException("Expected value to contain '$needle', got: " . substr((string)$this->val, 0, 200));
            }
        }

        public function toBeTrue(): void  { $this->toBe(true); }
        public function toBeFalse(): void { $this->toBe(false); }
        public function toBeNull(): void  { $this->toBe(null); }

        public function toBeGreaterThan(mixed $n): void {
            if (!($this->val > $n)) {
                throw new \RuntimeException("Expected {$this->val} > $n");
            }
        }

        public function toHaveKey(string $key): void {
            if (!array_key_exists($key, (array)$this->val)) {
                throw new \RuntimeException("Expected key '$key' in " . json_encode($this->val));
            }
        }

        public function toBeArray(): void {
            if (!is_array($this->val)) {
                throw new \RuntimeException("Expected array, got " . gettype($this->val));
            }
        }
    };
}

// ─── Load test suites ─────────────────────────────────────────────────────────

$suites = glob(__DIR__ . '/*.test.php');
foreach ($suites as $suite) require_once $suite;

// ─── Summary ─────────────────────────────────────────────────────────────────

echo "\n" . str_repeat('─', 50) . "\n";
$total = $passed + $failed;
if ($failed === 0) {
    echo "\033[32m✓ All $total tests passed\033[0m\n";
} else {
    echo "\033[31m✗ $failed/$total tests failed\033[0m\n";
    foreach ($failures as $f) echo "  • $f\n";
}
echo str_repeat('─', 50) . "\n";
exit($failed > 0 ? 1 : 0);
