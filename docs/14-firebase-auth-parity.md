# Firebase Auth Parity Checkpoint

This is a staging-only acceptance test for Phase 4. It verifies that Firebase
identity verification still produces the same owner-scoped behavior the
application had with Supabase Auth.

The smoke test never stores tokens in the repository. Provide short-lived
tokens through the local shell only, and clear the variables after the run.

## Run Against Preview

From `eil-dashboard` in PowerShell:

```powershell
$env:AUTH_PARITY_BASE_URL = "https://your-preview.vercel.app"
$env:AUTH_PARITY_TOKEN_A = "paste-a-short-lived-id-token-here"
$env:AUTH_PARITY_TOKEN_B = "optional-second-user-token"
$env:AUTH_PARITY_OWNER_A = "optional-owner-uuid-for-user-a"
$env:AUTH_PARITY_RUN_ID_A = "optional-user-a-ingestion-run-id"
npm run auth:parity
Remove-Item Env:AUTH_PARITY_BASE_URL,Env:AUTH_PARITY_TOKEN_A,Env:AUTH_PARITY_TOKEN_B,Env:AUTH_PARITY_OWNER_A,Env:AUTH_PARITY_RUN_ID_A -ErrorAction SilentlyContinue
```

The test covers:

- unauthenticated rejection for profile, projects, folders, library, and chat;
- mapped Firebase user access to those read paths;
- invalid-token rejection;
- distinct owner IDs for two mapped users;
- absence of user A's owner ID in user B's list responses;
- optional direct paper isolation using `AUTH_PARITY_RUN_ID_A`.

## Manual Acceptance

Before moving to Phase 5, also verify in the Preview UI:

1. User A can log in, refresh, edit a profile, and log out.
2. User B cannot see or open User A's papers, folders, projects, threads, or messages.
3. An unmapped Firebase account receives a clear 403 response.
4. A disabled or revoked account fails when `FIREBASE_CHECK_REVOKED=true`.
5. Production remains on `AUTH_PROVIDER=supabase` until this checkpoint and the API smoke test pass.

The test tokens are sensitive credentials. Never commit them, put them in a
`NEXT_PUBLIC_*` variable, or include them in bug reports.
