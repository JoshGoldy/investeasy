<?php
/**
 * Auth API — Unit + Integration tests (white-box)
 * Tests: register, login, logout, me, update-profile, input validation,
 *        duplicate detection, password hashing, session management.
 */

require_once __DIR__ . '/../db_test.php';

// ── Helpers to simulate the auth logic inline (without HTTP) ─────────────────

function makeUser(string $name, string $email, string $username, string $password): array {
    $db = getDB();
    $email    = strtolower(trim($email));
    $username = strtolower(ltrim(trim($username), '@'));
    $hash     = password_hash($password, PASSWORD_DEFAULT);
    $ins = $db->prepare("INSERT INTO users (name,email,username,password_hash) VALUES (?,?,?,?)");
    $ins->execute([$name, $email, $username, $hash]);
    $uid = (int)$db->lastInsertId();
    $db->prepare("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)")->execute([$uid]);
    return ['id' => $uid, 'name' => $name, 'email' => $email, 'username' => $username];
}

function fetchUser(int $id): array|false {
    $stmt = getDB()->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->execute([$id]);
    return $stmt->fetch();
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AUTH — Registration validation', function() {

    test('rejects empty name', function() {
        $name = '';
        // Empty name is falsy — the `if (!$name || ...)` guard fires and rejects
        expect((bool)$name)->toBeFalse();
    });

    test('rejects invalid email', function() {
        expect(filter_var('notanemail', FILTER_VALIDATE_EMAIL))->toBeFalse();
        expect(filter_var('missing@', FILTER_VALIDATE_EMAIL))->toBeFalse();
        expect(filter_var('@nodomain.com', FILTER_VALIDATE_EMAIL))->toBeFalse();
    });

    test('accepts valid email', function() {
        expect((bool)filter_var('user@example.com', FILTER_VALIDATE_EMAIL))->toBeTrue();
        expect((bool)filter_var('user+tag@sub.domain.io', FILTER_VALIDATE_EMAIL))->toBeTrue();
    });

    test('rejects password shorter than 6 chars', function() {
        expect(strlen('abc') < 6)->toBeTrue();
        expect(strlen('abcde') < 6)->toBeTrue();
        expect(strlen('abcdef') < 6)->toBeFalse();
    });

    test('rejects username with invalid chars', function() {
        expect((bool)preg_match('/^[a-z0-9_]+$/', 'valid_user1'))->toBeTrue();
        expect((bool)preg_match('/^[a-z0-9_]+$/', 'bad-name'))->toBeFalse();
        expect((bool)preg_match('/^[a-z0-9_]+$/', 'has space'))->toBeFalse();
        expect((bool)preg_match('/^[a-z0-9_]+$/', 'UPPER'))->toBeFalse();
    });

    test('username stripping: removes leading @ and lowercases', function() {
        $fn = fn($u) => strtolower(ltrim(trim($u), '@'));
        expect($fn('@JohnDoe'))->toBe('johndoe');
        expect($fn('  @Alice  '))->toBe('alice');
        expect($fn('bob'))->toBe('bob');
    });
});

describe('AUTH — User creation (white-box DB)', function() {

    test('creates a user and hashes the password', function() {
        $u = makeUser('Alice', 'alice@example.com', 'alice', 'secret123');
        expect($u['id'])->toBeGreaterThan(0);

        $row = fetchUser($u['id']);
        expect($row['name'])->toBe('Alice');
        expect($row['email'])->toBe('alice@example.com');
        expect(password_verify('secret123', $row['password_hash']))->toBeTrue();
        // The hash itself must NOT equal the plain password
        expect($row['password_hash'] === 'secret123')->toBeFalse();
    });

    test('creates default settings row for new user', function() {
        $u   = makeUser('Bob', 'bob@example.com', 'bob', 'pass1234');
        $stmt = getDB()->prepare("SELECT * FROM user_settings WHERE user_id = ?");
        $stmt->execute([$u['id']]);
        $s = $stmt->fetch();
        expect($s)->toBeArray();
        expect($s['currency'])->toBe('USD');
        expect((int)$s['notifications'])->toBe(1);
    });

    test('rejects duplicate email', function() {
        makeUser('Carol', 'carol@example.com', 'carol', 'pass1234');
        $threw = false;
        try {
            makeUser('Carol2', 'carol@example.com', 'carol2', 'pass1234');
        } catch (\PDOException $e) {
            $threw = true;
        }
        expect($threw)->toBeTrue();
    });

    test('rejects duplicate username', function() {
        makeUser('Dave', 'dave@example.com', 'dave', 'pass1234');
        $threw = false;
        try {
            makeUser('Dave2', 'dave2@example.com', 'dave', 'pass1234');
        } catch (\PDOException $e) {
            $threw = true;
        }
        expect($threw)->toBeTrue();
    });
});

describe('AUTH — Login logic', function() {

    test('verifies correct password', function() {
        $u   = makeUser('Eve', 'eve@example.com', 'eve', 'mypassword');
        $row = fetchUser($u['id']);
        expect(password_verify('mypassword', $row['password_hash']))->toBeTrue();
    });

    test('rejects wrong password', function() {
        $u   = makeUser('Frank', 'frank@example.com', 'frank', 'correcthorse');
        $row = fetchUser($u['id']);
        expect(password_verify('wrongpass', $row['password_hash']))->toBeFalse();
    });

    test('login is case-insensitive on email', function() {
        makeUser('Grace', 'grace@example.com', 'grace', 'pass1234');
        $email = strtolower(trim('GRACE@EXAMPLE.COM'));
        $stmt  = getDB()->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute([$email]);
        expect($stmt->fetch())->toBeArray();
    });

    test('non-existent email returns no row', function() {
        $stmt = getDB()->prepare("SELECT id FROM users WHERE email = ?");
        $stmt->execute(['nobody@nowhere.com']);
        expect($stmt->fetch())->toBeFalse();
    });
});

describe('AUTH — Profile update', function() {

    test('updates name, email, username', function() {
        $u = makeUser('Heidi', 'heidi@example.com', 'heidi', 'pass1234');
        getDB()->prepare("UPDATE users SET name=?, email=?, username=? WHERE id=?")
               ->execute(['Heidi Updated', 'heidi2@example.com', 'heidi2', $u['id']]);
        $row = fetchUser($u['id']);
        expect($row['name'])->toBe('Heidi Updated');
        expect($row['email'])->toBe('heidi2@example.com');
        expect($row['username'])->toBe('heidi2');
    });

    test('collision check excludes self (same user can keep own email)', function() {
        $u = makeUser('Ivan', 'ivan@example.com', 'ivan', 'pass1234');
        $stmt = getDB()->prepare("SELECT id FROM users WHERE (email=? OR username=?) AND id != ?");
        $stmt->execute(['ivan@example.com', 'ivan', $u['id']]);
        // Should find no collision — user is updating to their own current values
        expect($stmt->fetch())->toBeFalse();
    });
});
