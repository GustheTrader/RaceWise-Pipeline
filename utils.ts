import { PipelineResult, Race, Horse } from "./types";

/**
 * Calculates handicapping metrics using the weighted ensemble model.
 * The modelScore is now a non-normalized summed total.
 */
export const processHandicapping = (data: PipelineResult): PipelineResult => {
  const processedRaces = data.races.map(race => {
    // 1. Calculate Base Ensemble Scores for ALL horses
    let raceHorses = race.horses.map(horse => {
      // Bonus flag for longshot indicators
      const hc20Bonus = (horse.hf || "").includes("20") ? 100 : 0;
      
      /**
       * UPDATED ENSEMBLE WEIGHTS (v3.7.0)
       * Total: 100%
       * Fire Speed Figures: 20% (Primary Signal)
       * CatBoost Component: 15.4%
       * LightGBM Component: 11.0%
       * Jockey Win Power: 12.0%
       * Trainer Win Power: 12.0%
       * HC 20 Longshot Logic: 12.0%
       * Consensus Rating: 6.6%
       * RNN Sequence: 6.6%
       * XGBoost Factor: 4.4%
       */
      const baseEnsemble = 
        (Number(horse.fire || 0) * 0.20) +            // Quantum Fire (High Weight)
        (Number(horse.catboostScore || 0) * 0.154) + 
        (Number(horse.lightgbmScore || 0) * 0.11) + 
        (Number(horse.rnnScore || 0) * 0.066) + 
        (Number(horse.xgboostScore || 0) * 0.044) + 
        (Number(horse.consensus || 0) * 0.066) + 
        (Number(horse.jockeyWinRate || 0) * 0.12) + 
        (Number(horse.trainerWinRate || 0) * 0.12) + 
        (hc20Bonus * 0.12);

      // Class Drop Bonus (Multiplicative weight)
      let boostMultiplier = 1.0;
      if (horse.classToday !== undefined && horse.classRecentBest !== undefined) {
        const drop = horse.classRecentBest - horse.classToday;
        if (drop >= 10) boostMultiplier = 1.25;
        else if (drop >= 5) boostMultiplier = 1.10;
      }

      // Final raw weighted score (unnormalized)
      const weightedScore = (baseEnsemble || 1) * boostMultiplier;
      return { ...horse, weightedScore };
    });

    // 2. Assign modelScore as the raw summed total
    raceHorses = raceHorses.map(h => ({
      ...h,
      modelScore: parseFloat((h.weightedScore || 0).toFixed(1))
    }));

    // 3. Rank ALL horses by raw model score
    raceHorses.sort((a, b) => b.modelScore - a.modelScore);
    
    // Assign ranks, handling ties
    let currentRank = 1;
    const rankedHorses = raceHorses.map((h, idx, arr) => {
      if (idx > 0 && h.modelScore < arr[idx - 1].modelScore) {
        currentRank = idx + 1;
      }
      return { ...h, rank: currentRank };
    });

    // 4. Calculate total summed score for the race to derive win percentage
    const totalModelScore = rankedHorses.reduce((acc, h) => acc + h.modelScore, 0) || 1;
    
    const finalHorses: Horse[] = rankedHorses.map(h => {
      // Use individual score relative to total summed field score for win percentage
      const individualScore = h.modelScore > 0 ? h.modelScore : 0.1;
      const winProbability = individualScore / totalModelScore;
      
      const fairOddsVal = (1 / winProbability) - 1;
      const modelOdds = formatToFractional(fairOddsVal);
      const winPercentage = parseFloat((winProbability * 100).toFixed(1));

      return { 
        ...h, 
        modelOdds, 
        winPercentage 
      } as Horse;
    });

    return { ...race, horses: finalHorses };
  });

  return { ...data, races: processedRaces };
};

const formatToFractional = (decimalOdds: number): string => {
  if (decimalOdds < 0.15) return "1-9";
  if (decimalOdds < 0.35) return "1-5";
  if (decimalOdds < 0.5) return "2-5";
  if (decimalOdds < 0.9) return "4-5";
  if (decimalOdds < 1.1) return "1-1";
  
  const commonFractions = [
    { n: 1, d: 1, v: 1 }, { n: 6, d: 5, v: 1.2 }, { n: 7, d: 5, v: 1.4 },
    { n: 3, d: 2, v: 1.5 }, { n: 8, d: 5, v: 1.6 }, { n: 9, d: 5, v: 1.8 },
    { n: 2, d: 1, v: 2 }, { n: 5, d: 2, v: 2.5 }, { n: 3, d: 1, v: 3 },
    { n: 7, d: 2, v: 3.5 }, { n: 4, d: 1, v: 4 }, { n: 9, d: 2, v: 4.5 },
    { n: 5, d: 1, v: 5 }, { n: 6, d: 1, v: 6 }, { n: 8, d: 1, v: 8 },
    { n: 10, d: 1, v: 10 }, { n: 12, d: 1, v: 12 }, { n: 15, d: 1, v: 15 },
    { n: 20, d: 1, v: 20 }, { n: 30, d: 1, v: 30 }, { n: 50, d: 1, v: 50 },
    { n: 99, d: 1, v: 99 }
  ];

  let bestMatch = commonFractions[0];
  let minDiff = Math.abs(decimalOdds - commonFractions[0].v);

  for (const frac of commonFractions) {
    const diff = Math.abs(decimalOdds - frac.v);
    if (diff < minDiff) {
      minDiff = diff;
      bestMatch = frac;
    }
  }

  return `${bestMatch.n}-${bestMatch.d}`;
};

export const convertToCSV = (data: PipelineResult): string => {
  const header = [
    "Rank", "Track", "Date", "RaceNum", "Pg_Num", "Horse", 
    "ML_Odds", "Model_Odds", "Model_Score", "Win_Prob", 
    "Consensus", "Jockey_Win_Pct", "Trainer_Win_Pct", "HF", "Comments",
    "FIRE", "CPR", "FastFig",
    "PP1_Date", "PP1_Finish", "PP1_Dist",
    "PP2_Date", "PP2_Finish", "PP2_Dist",
    "PP3_Date", "PP3_Finish", "PP3_Dist",
    "PP4_Date", "PP4_Finish", "PP4_Dist",
    "PP5_Date", "PP5_Finish", "PP5_Dist"
  ].join(",");

  const rows: string[] = [];
  data.races.forEach((race) => {
    race.horses.forEach((horse) => {
      const pps = horse.pastPerformances || [];
      const ppCells: string[] = [];
      for (let i = 0; i < 5; i++) {
        const pp = pps[i];
        ppCells.push(pp && pp.date ? `"${pp.date.replace(/"/g, '""')}"` : '""');
        ppCells.push(pp && pp.finish ? `"${pp.finish.replace(/"/g, '""')}"` : '""');
        ppCells.push(pp && pp.dist ? `"${pp.dist.replace(/"/g, '""')}"` : '""');
      }

      const row = [
        horse.rank,
        `"${data.track}"`,
        `"${data.date}"`,
        race.number,
        `"${horse.programNumber}"`,
        `"${horse.name}"`,
        `"${horse.morningLine || ""}"`,
        `"${horse.modelOdds}"`,
        horse.modelScore,
        `"${horse.winPercentage}%"`,
        horse.consensus || 0,
        `"${horse.jockeyWinRate}%"`,
        `"${horse.trainerWinRate}%"`,
        `"${(horse.hf || "").replace(/"/g, '""')}"`,
        `"${(horse.comments || "").replace(/"/g, '""')}"`,
        horse.fire || 0,
        horse.cpr || 0,
        horse.fastFig || 0,
        ...ppCells
      ].join(",");
      rows.push(row);
    });
  });

  return [header, ...rows].join("\n");
};

export const convertToXML = (data: PipelineResult): string => {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<HandicappingReport>\n';
  xml += `  <Track>${data.track}</Track>\n`;
  xml += `  <Date>${data.date}</Date>\n`;
  
  data.races.forEach((race) => {
    xml += `  <Race number="${race.number}" conditions="${race.distance} ${race.surface}">\n`;
    race.horses.forEach((horse) => {
      xml += `    <Horse rank="${horse.rank}">\n`;
      xml += `      <Name>${horse.name}</Name>\n`;
      xml += `      <Odds ml="${horse.morningLine}" model="${horse.modelOdds}" />\n`;
      xml += `      <WinProbability>${horse.winPercentage}%</WinProbability>\n`;
      xml += `      <Score>${horse.modelScore}</Score>\n`;
      xml += `      <Consensus>${horse.consensus}</Consensus>\n`;
      xml += `      <HF>${horse.hf}</HF>\n`;
      xml += `    </Horse>\n`;
    });
    xml += `  </Race>\n`;
  });

  xml += "</HandicappingReport>";
  return xml;
};

export const downloadFile = (content: string, fileName: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};