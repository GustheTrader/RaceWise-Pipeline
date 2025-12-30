
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bqvavkzgmznjfirgfyhd.supabase.com';

/**
 * Creates a fresh Supabase client instance using the environment key.
 * Throws a descriptive error if the key is missing to prevent silent failures.
 */
const getClient = () => {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("Supabase key is missing (process.env.SUPABASE_ANON_KEY). Please ensure your environment is configured correctly.");
  }
  return createClient(SUPABASE_URL, key);
};

/**
 * Persists race entry data to Supabase.
 * @param data The flattened array of horse/entry data.
 * @param track The track name to ensure is included in the upsert.
 */
export const persistRaceData = async (data: any[], track: string) => {
  const supabase = getClient();
  
  // Map through data to ensure track is explicitly set for every row
  const rows = data.map(row => ({
    ...row,
    track: track
  }));

  try {
    const { error } = await supabase
      .from('races')
      .upsert(rows, { onConflict: 'race_id' });
    
    if (error) {
      console.error("Supabase Database Error:", JSON.stringify(error, null, 2));
      throw error;
    }
  } catch (err: any) {
    // Catching network errors (like TypeError: Failed to fetch)
    if (err instanceof TypeError && err.message === 'Failed to fetch') {
      console.error("Supabase Network Error: Connection refused. Check if the project is paused or if an ad-blocker is active.");
    }
    throw err;
  }
};

/**
 * Sets up a realtime subscription for odds updates.
 */
export const subscribeToOdds = (raceId: string, callback: (payload: any) => void) => {
  const supabase = getClient();
  return supabase
    .channel(`odds-${raceId}`)
    .on('postgres_changes', { 
      event: 'UPDATE', 
      schema: 'public', 
      table: 'horse_odds', 
      filter: `race_id=eq.${raceId}` 
    }, callback)
    .subscribe();
}
