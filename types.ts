
export interface GroundingSource {
  uri: string;
  title: string;
}

export interface PastPerformance {
  date: string;
  finish: string;
  dist: string;
}

export interface Horse {
  name: string;
  programNumber: string;
  fire: number;
  cpr: number;
  fastFig: number;
  consensus: number;
  
  // Ensemble Component Scores
  catboostScore: number; // 40% weight
  lightgbmScore: number; // 30% weight
  rnnScore: number;      // 20% weight
  xgboostScore: number;  // 10% weight
  
  classToday?: number;
  classRecentBest?: number;
  weightedScore?: number; // Internal base weighted score
  modelScore: number;     // Final calculated score (Raw summed ensemble)
  modelOdds: string;      // Fair odds calculation (Mandatory)
  winPercentage: number;  // Win probability calculation (Mandatory)
  jockeyWinRate: number;  // (Mandatory)
  trainerWinRate: number; // (Mandatory)
  hf?: string;            // Handicapping Factors string from column 18
  rank?: number;
  comments: string;
  pastPerformances: PastPerformance[];
  jockey: string;
  trainer: string;
  morningLine: string;    // Required string field
  liveOdds: string;       // Required string field
  lastOddsUpdate?: string;
}

export interface Race {
  number: number;
  distance: string;
  surface: string;
  horses: Horse[];
}

export interface PipelineResult {
  track: string;
  date: string;
  races: Race[];
  groundingSources?: GroundingSource[];
}
