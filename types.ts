
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
  comments: string;
  pastPerformances: PastPerformance[];
  jockey?: string;
  trainer?: string;
  morningLine?: string;
  liveOdds?: string;
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
