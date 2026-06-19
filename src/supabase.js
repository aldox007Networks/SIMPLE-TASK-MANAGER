import { createClient } from "@supabase/supabase-js";

// ┌────────────────────────────────────────────────────────────┐
// │  PEGA AQUÍ TUS DOS DATOS DE SUPABASE                        │
// │  (Supabase → Connect → App Frameworks, o Settings → API)   │
// └────────────────────────────────────────────────────────────┘

const SUPABASE_URL = "https://vhhxdjoipcosrbivebtn.supabase.co";       // ej. https://abcd1234.supabase.co
const SUPABASE_KEY = "sb_publishable_p8lMEufUk00POTBpYOZgbQ_fRkfCfoc";   // empieza con sb_publishable_...

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
