
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bqvavkzgmznjfirgfyhd.supabase.co';
// Use the provided anon key for the specific project reference
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxdmF2a3pnbXpuamZpcmdmeWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYzODE0NjMsImV4cCI6MjA2MTk1NzQ2M30.s6ZPJNjQpcNC6_CRUKA4g2yFJUEbxikQbApx1o_lLCs';

/**
 * Creates a fresh Supabase client instance using the provided anon key.
 */
const getClient = () => {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
    if (err instanceof TypeError && err.message.toLowerCase().includes('failed to fetch')) {
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
