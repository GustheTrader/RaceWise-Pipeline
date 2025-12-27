import { PipelineResult, Race, Horse } from "./types";

export const convertToCSV = (data: PipelineResult): string => {
  const header = "RaceID,Horse,Pg_Num,Jockey,Trainer,FIRE,CPR,FastFig,Consensus,PP1_Date,PP1_Finish,PP1_Dist,PP2_Date,PP2_Finish,PP2_Dist,PP3_Date,PP3_Finish,PP3_Dist,PP4_Date,PP4_Finish,PP4_Dist,PP5_Date,PP5_Finish,PP5_Dist";
  const rows: string[] = [];

  const trackCode = (data.track || "XX").substring(0, 2).toUpperCase();
  const dateFormatted = (data.date || "").replace(/-/g, "").substring(4);

  data.races.forEach((race) => {
    const raceID = `${trackCode}_${dateFormatted}_${race.number.toString().padStart(2, '0')}`;
    race.horses.forEach((horse) => {
      const pps = horse.pastPerformances || [];
      const ppData = [];
      // Extract top 5 past performances
      for (let i = 0; i < 5; i++) {
        const pp = pps[i];
        ppData.push(pp ? `"${pp.date}"` : "");
        ppData.push(pp ? `"${pp.finish}"` : "");
        ppData.push(pp ? `"${pp.dist}"` : "");
      }
      
      const baseData = [
        raceID,
        `"${horse.name}"`,
        horse.programNumber,
        `"${horse.jockey || ""}"`,
        `"${horse.trainer || ""}"`,
        horse.fire,
        horse.cpr,
        horse.fastFig,
        horse.consensus
      ];
      
      rows.push([...baseData, ...ppData].join(","));
    });
  });

  return [header, ...rows].join("\n");
};

export const convertToXML = (data: PipelineResult): string => {
  const trackCode = (data.track || "XX").substring(0, 2).toUpperCase();
  const dateFormatted = (data.date || "").replace(/-/g, "");

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<RaceCard>\n';
  
  data.races.forEach((race) => {
    // Explicitly handle distance and surface as attributes with defaults if missing
    const raceDistance = race.distance?.trim() || "Unknown";
    const raceSurface = race.surface?.trim() || "Main";

    xml += `  <Race number="${race.number}" distance="${raceDistance}" surface="${raceSurface}">\n`;
    race.horses.forEach((horse) => {
      const entryId = `${trackCode}_${dateFormatted}_${race.number.toString().padStart(2, '0')}_${horse.programNumber.padStart(2, '0')}`;
      
      // Ensure comments is not empty and provide default placeholder
      const safeComment = (horse.comments && horse.comments.trim()) 
        ? horse.comments 
        : "No analyst comments available for this entry.";

      xml += `    <Entry id="${entryId}">\n`;
      xml += `      <Horse>${horse.name}</Horse>\n`;
      xml += `      <Jockey>${horse.jockey || ""}</Jockey>\n`;
      xml += `      <Trainer>${horse.trainer || ""}</Trainer>\n`;
      xml += `      <Comments><![CDATA[${safeComment}]]></Comments>\n`;
      xml += `      <PastPerformances>\n`;
      // XML includes all performances extracted (now up to 5)
      horse.pastPerformances?.forEach((pp) => {
        xml += `        <Run date="${pp.date}" finish="${pp.finish}" dist="${pp.dist}" />\n`;
      });
      xml += `      </PastPerformances>\n`;
      xml += `    </Entry>\n`;
    });
    xml += `  </Race>\n`;
  });

  xml += "</RaceCard>";
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
    reader.onload = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};
