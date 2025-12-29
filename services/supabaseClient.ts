import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bqvavkzgmznjfirgfyhd.supabase.com';
// Note: In a production environment, this should be an environment variable.
// For this context, we assume SUPABASE_ANON_KEY is available in the environment.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'public-anon-key-placeholder';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Persists race entry data to Supabase.
 * @param data The flattened array of horse/entry data.
 * @param track The track name to ensure is included in the upsert.
 */
export const persistRaceData = async (data: any[], track: string) => {
  // Map through data to ensure track is explicitly set for every row
  const rows = data.map(row => ({
    ...row,
    track: track // Explicitly include the track field as requested
  }));

  const { error } = await supabase
    .from('races')
    .upsert(rows, { onConflict: 'race_id' });
  
  if (error) {
    console.error("Supabase Operation Error:", error);
    throw error;
  }
};

export const subscribeToOdds = (raceId: string, callback: (payload: any) => void) => {
  return supabase
    .channel(`odds-${raceId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'horse_odds', filter: `race_id=eq.${raceId}` }, callback)
    .subscribe();
};