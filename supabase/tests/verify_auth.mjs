import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error("Load .env.local before running this test.");
}

const testId = randomUUID();
const userId = randomUUID();
const email = `auth-test-${Date.now()}@gmail.com`;
const password = `Sugar!${randomUUID()}Z9`;
let fixtureCreated = false;

const dbQuery = (sql) =>
  execFileSync("npx", ["supabase", "db", "query", "--linked", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const supabase = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

try {
  const { error: anonymousError } = await supabase.from("projects").select("id").limit(1);
  if (!anonymousError) {
    throw new Error("Anonymous project query unexpectedly succeeded.");
  }

  // Build one confirmed Auth fixture directly in the Auth schema. This avoids
  // sending email while still exercising the real password sign-in endpoint.
  dbQuery(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change, phone, phone_change,
      phone_change_token, email_change_token_current, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000'::uuid,
      '${userId}'::uuid,
      'authenticated',
      'authenticated',
      '${email}',
      crypt('${password}', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Auth Test User","test_id":"${testId}"}'::jsonb,
      now(),
      now(),
      '', '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at,
      created_at, updated_at
    ) values (
      '${userId}',
      '${userId}'::uuid,
      '{"sub":"${userId}","email":"${email}","email_verified":true,"phone_verified":false}'::jsonb,
      'email',
      now(),
      now(),
      now()
    );
  `);
  fixtureCreated = true;

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || signInData.user?.id !== userId) {
    throw signInError ?? new Error("Password login returned the wrong user.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();
  if (profileError || profile?.display_name !== "Auth Test User") {
    throw profileError ?? new Error("Profile trigger did not create the expected profile.");
  }

  const { data: projects, error: projectsError } = await supabase.from("projects").select("id");
  if (projectsError || projects.length !== 0) {
    throw projectsError ?? new Error("Authenticated non-member could read project data.");
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  if (signOutError) throw signOutError;

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) {
    throw new Error("Local session still exists after sign out.");
  }

  console.log("email/password sign-in, profile trigger, non-member RLS, and sign-out passed");
} finally {
  if (fixtureCreated) {
    dbQuery(`delete from auth.users where id = '${userId}'::uuid;`);
  }
}
