import { createClient } from "@supabase/supabase-js";

// ┌────────────────────────────────────────────────────────────┐
// │  PEGA AQUÍ TUS DOS DATOS DE SUPABASE                        │
// │  (Supabase → Connect → App Frameworks, o Settings → API)   │
// └────────────────────────────────────────────────────────────┘

const SUPABASE_URL = "PEGA_AQUI_TU_PROJECT_URL";       // ej. https://abcd1234.supabase.co
const SUPABASE_KEY = "PEGA_AQUI_TU_PUBLISHABLE_KEY";   // empieza con sb_publishable_...

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
