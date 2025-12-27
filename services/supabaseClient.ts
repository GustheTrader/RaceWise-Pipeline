
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bqvavkzgmznjfirgfyhd.supabase.com';
// Note: In a production environment, this should be an environment variable.
// For this context, we assume SUPABASE_ANON_KEY is available in the environment.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'public-anon-key-placeholder';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const persistRaceData = async (data: any) => {
  const { error } = await supabase
    .from('races')
    .upsert(data, { onConflict: 'race_id' });
  
  if (error) throw error;
};

export const subscribeToOdds = (raceId: string, callback: (payload: any) => void) => {
  return supabase
    .channel(`odds-${raceId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'horse_odds', filter: `race_id=eq.${raceId}` }, callback)
    .subscribe();
};
