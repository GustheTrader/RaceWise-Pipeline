
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { parseRacingDigest, parseBackupEntries, syncLiveDataFromWeb, parseMorningCard, scrapeOTBData, parseDRF } from './services/llmProvider';
import { PipelineResult, Horse } from './types';
import { convertToCSV, convertToXML, downloadFile, fileToBase64, processHandicapping } from './utils';
import { persistRaceData } from './services/supabaseClient';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer, 
  Cell 
} from 'recharts';
import { 
  TrendingUp,
  RefreshCw,
  ChevronDown,
  Database,
  CloudUpload,
  Activity,
  Download,
  Zap,
  Timer,
  LayoutGrid,
  ClipboardList,
  Radar,
  Star,
  ShieldCheck,
  XCircle,
  FileText,
  AlertCircle,
  Hash,
  BarChart3,
  User,
  Users,
  CheckCircle2,
  Clock,
  Play,
  Pause,
  Scan,
  Save,
  Globe,
  ListFilter,
  Ticket,
  FileUp,
  CheckCircle,
  Cloud,
  Layers,
  Award,
  Cpu,
  MousePointer2,
  Share2,
  Copy,
  Check,
  Info,
  Table
} from 'lucide-react';

const TRACKS = [
  { id: 'santaanita', name: 'Santa Anita Park', status: 'ACTIVE' },
  { id: 'losalamitosqh', name: 'Los Alamitos QH', status: 'LIVE' },
  { id: 'turfway', name: 'Turfway Park', status: 'OFF' },
  { id: 'turfparadise', name: 'Turf Paradise', status: '47 MTP' },
  { id: 'shatin', name: 'HK Sha Tin', status: '9:00 PM' },
  { id: 'aqueduct', name: 'Aqueduct', status: 'OFFICIAL' },
  { id: 'fairgrounds', name: 'Fair Grounds', status: 'OFFICIAL' },
  { id: 'gulfstream', name: 'Gulfstream Park', status: 'OFFICIAL' },
  { id: 'oaklawn', name: 'Oaklawn Park', status: 'OFFICIAL' },
  { id: 'tampa', name: 'Tampa Bay Downs', status: 'OFFICIAL' },
  { id: 'custom', name: 'Other / Custom...', status: 'MANUAL' }
];

type ToolMode = 'morning_card' | 'digest' | 'entry' | 'drf' | 'live';
type ActiveTab = 'preview' | 'betting_sheet' | 'rankings' | 'csv' | 'betting_table' | 'xml';

const App: React.FC = () => {
  const [inputText, setInputText] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<{ file: File; base64: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isOTBScraping, setIsOTBScraping] = useState<boolean>(false);
  const [isSyncingDB, setIsSyncingDB] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [otbReference, setOtbReference] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('preview');
  const [toolMode, setToolMode] = useState<ToolMode>('morning_card');
  const [selectedTrackId, setSelectedTrackId] = useState<string>(TRACKS[0].id);
  const [customTrackName, setCustomTrackName] = useState<string>('');
  const [dbStatus, setDbStatus] = useState<'idle' | 'synced' | 'error'>('idle');
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const progressInterval = useRef<number | null>(null);

  const startProgress = (message: string) => {
    setProgress(0);
    setStatusMessage(message);
    if (progressInterval.current) window.clearInterval(progressInterval.current);
    progressInterval.current = window.setInterval(() => {
      setProgress(prev => (prev < 94 ? prev + 1 : prev));
    }, 140);
  };

  const endProgress = (message: string = 'Processing complete.') => {
    if (progressInterval.current) window.clearInterval(progressInterval.current);
    setProgress(100);
    setStatusMessage(message);
    setTimeout(() => { 
      setProgress(0); 
      setStatusMessage(''); 
      setIsProcessing(false);
    }, 2000);
  };

  const getEffectiveTrackName = () => selectedTrackId === 'custom' ? customTrackName : TRACKS.find(t => t.id === selectedTrackId)?.name || '';

  const processFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      setError("Only PDF files are supported for Quantum Parsing.");
      return;
    }
    const base64 = await fileToBase64(file);
    setSelectedFile({ file, base64 });
    setInputText('');
    setError(null);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  const handleRunTool = async () => {
    if (toolMode !== 'live' && !inputText.trim() && !selectedFile && !getEffectiveTrackName()) return;
    setIsProcessing(true);
    setError(null);
    const trackName = getEffectiveTrackName();
    
    try {
      let data: PipelineResult;
      const inputMethodPrefix = selectedFile ? "Quantum Parsing: " : "Model Sync: ";

      if (toolMode === 'morning_card') {
        startProgress(`${inputMethodPrefix}Deep Web Scraping & OTB Market Sync...`);
        handleScrapeOTB(true);
        const request = selectedFile ? { pdfData: { data: selectedFile.base64, mimeType: selectedFile.file.type } } : { text: inputText };
        data = await parseMorningCard(request, trackName);
        if (!data.track || data.track.toLowerCase().includes('unknown')) data.track = trackName;
      } else if (toolMode === 'digest') {
        startProgress(`${inputMethodPrefix}TRD Hybrid Neural Ensemble...`);
        const request = selectedFile ? { pdfData: { data: selectedFile.base64, mimeType: selectedFile.file.type } } : { text: inputText };
        data = await parseRacingDigest(request);
      } else if (toolMode === 'entry') {
        startProgress(`${inputMethodPrefix}Syncing Backup Master Card...`);
        const request = selectedFile ? { pdfData: { data: selectedFile.base64, mimeType: selectedFile.file.type } } : { text: inputText };
        data = await parseBackupEntries(request);
      } else if (toolMode === 'drf') {
        startProgress(`${inputMethodPrefix}DRF Upload & Parsing...`);
        const request = selectedFile ? { pdfData: { data: selectedFile.base64, mimeType: selectedFile.file.type } } : { text: inputText };
        data = await parseDRF(request);
      } else {
        startProgress(`Real-time Odds Scan: ${trackName}...`);
        data = await syncLiveDataFromWeb(trackName);
      }
      
      const handicappingResult = processHandicapping(data);
      setResult(handicappingResult);
      setDbStatus('idle');
      endProgress("Pipeline Execution Successful.");
    } catch (err: any) {
      setError(err?.message || 'Neural pipeline execution failed.');
      setProgress(0);
      setIsProcessing(false);
    }
  };

  const formatSupabaseError = (err: any): string => {
    if (!err) return "Unknown Error";
    
    // Explicitly handle standard Fetch/Network error
    if (err instanceof TypeError && err.message.toLowerCase().includes('failed to fetch')) {
      return "Network Connection Refused. Possible causes: project is paused, invalid URL/Key, or an Ad-Blocker is blocking the request.";
    }

    if (typeof err === 'string') return err;
    
    const msg = err.message || err.error_description || err.error;
    const details = err.details || "";
    const hint = err.hint || "";
    const code = err.code || "";

    if (msg) {
      let full = msg;
      if (details) full += ` - ${details}`;
      if (hint) full += ` (Hint: ${hint})`;
      if (code) full += ` [Code: ${code}]`;
      return full;
    }

    try {
      return JSON.stringify(err, null, 2);
    } catch (e) {
      return String(err);
    }
  };

  const handlePushToSupabase = async () => {
    if (!result) return;
    setIsSyncingDB(true);
    setError(null);
    try {
      const flattenedData = result.races.flatMap(race => 
        race.horses.map(horse => ({
          race_id: `${result.track}_${result.date}_R${race.number}_${horse.programNumber}`.replace(/\s+/g, '_'),
          race_number: race.number,
          distance: race.distance,
          surface: race.surface,
          date: result.date,
          ...horse,
          pastPerformances: horse.pastPerformances || []
        }))
      );
      
      await persistRaceData(flattenedData, result.track);
      setDbStatus('synced');
    } catch (err: any) {
      console.error("Supabase Sync Failed", err);
      const detailedError = formatSupabaseError(err);
      setError(`Supabase Sync Failed: ${detailedError}`);
      setDbStatus('error');
    } finally {
      setIsSyncingDB(false);
    }
  };

  const handleScrapeOTB = async (silent = false) => {
    const trackName = getEffectiveTrackName();
    if (!silent) setIsOTBScraping(true);
    try {
      const data = await scrapeOTBData(trackName);
      setOtbReference(data);
    } catch (err) {
      console.error("Market Scrape Failed", err);
    } finally {
      if (!silent) setIsOTBScraping(false);
    }
  };

  const handleShare = async () => {
    if (!result) return;
    const topPicksText = result.races.map(r => {
      const top = r.horses.sort((a, b) => b.modelScore - a.modelScore)[0];
      return `Race ${r.number}: ${top.name} (${top.modelOdds})`;
    }).join('\n');
    const shareText = `RaceWise AI Analysis - ${result.track} (${result.date})\n\nTop Neural Picks:\n${topPicksText}\n\nAnalyzed at rasewiseai.com`;
    const shareUrl = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: `RaceWise AI - ${result.track}`, text: shareText, url: shareUrl }); }
      catch (err) { console.debug('Share API cancelled or failed', err); }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n\nLink: ${shareUrl}`);
        setShareStatus('copied');
        setTimeout(() => setShareStatus('idle'), 2000);
      } catch (err) { console.error('Clipboard copy failed', err); }
    }
  };

  const getTopSixWithTies = (horses: Horse[]) => {
    const sorted = [...horses].sort((a, b) => b.modelScore - a.modelScore);
    if (sorted.length <= 6) return sorted;
    const cutoffScore = sorted[5].modelScore;
    return sorted.filter((h, idx) => idx < 6 || h.modelScore === cutoffScore);
  };

  const renderTabContent = () => {
    if (!result) return null;

    if (activeTab === 'csv') {
      return (
        <div className="relative">
          <textarea 
            readOnly 
            value={convertToCSV(result)} 
            className="w-full h-[600px] bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 custom-scrollbar focus:outline-none"
          />
          <button 
            onClick={() => navigator.clipboard.writeText(convertToCSV(result))}
            className="absolute top-4 right-4 p-2 bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors border border-slate-700"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      );
    }
    
    if (activeTab === 'xml') {
      return (
        <div className="relative">
          <textarea 
            readOnly 
            value={convertToXML(result)} 
            className="w-full h-[600px] bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 custom-scrollbar focus:outline-none"
          />
          <button 
            onClick={() => navigator.clipboard.writeText(convertToXML(result))}
            className="absolute top-4 right-4 p-2 bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors border border-slate-700"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      );
    }

    if (activeTab === 'rankings') {
      return (
        <div className="space-y-12">
          {result.races.map(race => (
            <div key={race.number} className="space-y-6">
              <h3 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-2">
                <span className="text-blue-500">Race {race.number}</span> 
                <span className="text-sm text-slate-500 font-bold">{race.distance} • {race.surface}</span>
              </h3>
              <div className="h-64 w-full bg-slate-900/50  rounded-xl p-4 border border-slate-800">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={race.horses.slice().sort((a,b) => b.modelScore - a.modelScore).slice(0, 8)} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                    <XAxis type="number" stroke="#475569" fontSize={10} />
                    <YAxis dataKey="name" type="category" width={100} stroke="#475569" fontSize={10} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '0.5rem' }}
                      itemStyle={{ color: '#3b82f6', fontWeight: 900 }}
                    />
                    <Bar dataKey="modelScore" radius={[0, 4, 4, 0]}>
                      {race.horses.slice().sort((a,b) => b.modelScore - a.modelScore).slice(0, 8).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? '#3b82f6' : index === 1 ? '#8b5cf6' : '#334155'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === 'betting_sheet' || activeTab === 'preview') {
      return (
        <div className="space-y-8">
          {result.races.map(race => {
            const topHorses = getTopSixWithTies(race.horses);
            return (
              <div key={race.number} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl">
                <div className="flex justify-between items-end border-b border-slate-700 pb-4 mb-4 mt-2">
                  <div>
                    <h3 className="text-2xl font-black text-white uppercase tracking-tighter shadow-sm flex flex-col gap-1">
                      <span className="text-blue-500 text-sm tracking-widest leading-none">{result.track}</span>
                      RACE {race.number}
                    </h3>
                    <p className="text-xs font-bold text-slate-400 mt-2 uppercase tracking-wide">{race.distance} • {race.surface}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] tracking-widest text-slate-500 uppercase font-black">Top Pick Probability</span>
                    <p className="text-xl font-black text-emerald-400 mt-1">{topHorses[0]?.winPercentage}%</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {topHorses.map((horse, idx) => (
                    <div key={horse.programNumber} className={`relative p-4 rounded-xl border ${idx === 0 ? 'bg-blue-600/10 border-blue-500/30' : idx === 1 ? 'bg-violet-600/5 border-violet-500/20' : 'bg-slate-800/40 border-slate-700/50'} flex flex-col gap-3 justify-between`}>
                      {idx === 0 && <Star className="absolute top-3 right-3 w-4 h-4 text-emerald-400 fill-emerald-400/20" />}
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs ${idx === 0 ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-700 text-slate-300'}`}>
                            {horse.programNumber}
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-white leading-none mb-1 mr-6">{horse.name}</h4>
                            <p className="text-[9px] uppercase tracking-widest text-slate-400 truncate max-w-[120px]">{horse.jockey} • {horse.trainer}</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        <div className="bg-slate-950/50 rounded-lg p-2 flex flex-col items-center justify-center border border-slate-800/80">
                          <span className="text-[8px] uppercase tracking-widest text-slate-500 mb-0.5">SCORE</span>
                          <span className={`text-xs font-black ${idx === 0 ? 'text-blue-400' : 'text-slate-300'}`}>{horse.modelScore.toFixed(1)}</span>
                        </div>
                        <div className="bg-slate-950/50 rounded-lg p-2 flex flex-col items-center justify-center border border-slate-800/80">
                          <span className="text-[8px] uppercase tracking-widest text-slate-500 mb-0.5">MODEL</span>
                          <span className="text-xs font-black text-emerald-400">{horse.modelOdds}</span>
                        </div>
                        <div className="bg-slate-950/50 rounded-lg p-2 flex flex-col items-center justify-center border border-slate-800/80">
                          <span className="text-[8px] uppercase tracking-widest text-slate-500 mb-0.5">ML</span>
                          <span className="text-xs font-black text-slate-400">{horse.morningLine}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (activeTab === 'betting_table') {
      return (
        <div className="space-y-10">
          {result.races.map(race => (
            <div key={race.number} className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="p-4 bg-slate-800/80 border-b border-slate-700">
                 <h3 className="text-sm font-black text-white uppercase tracking-wider">Race {race.number} <span className="text-slate-400 mx-2">|</span> {race.distance}</h3>
              </div>
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[9px] font-black">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">PP</th>
                    <th className="px-4 py-3">Horse</th>
                    <th className="px-4 py-3 text-right">Model Score</th>
                    <th className="px-4 py-3 text-right">Win %</th>
                    <th className="px-4 py-3 text-right">Fair Odds</th>
                    <th className="px-4 py-3 text-right">ML</th>
                    <th className="px-4 py-3">Jockey / Trainer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {race.horses.concat().sort((a,b) => b.modelScore - a.modelScore).map((horse, idx) => (
                    <tr key={horse.programNumber} className={`hover:bg-slate-800/30 transition-colors ${idx === 0 ? 'bg-blue-900/10' : ''}`}>
                      <td className="px-4 py-3 font-black text-slate-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex w-6 h-6 items-center justify-center bg-slate-800 rounded-md text-[10px] font-black text-white">{horse.programNumber}</span>
                      </td>
                      <td className="px-4 py-3 font-bold text-white">{horse.name}</td>
                      <td className="px-4 py-3 text-right font-mono text-blue-400 font-bold">{horse.modelScore.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-300">{horse.winPercentage}%</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-400 font-bold">{horse.modelOdds}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">{horse.morningLine}</td>
                      <td className="px-4 py-3 text-slate-500 font-medium text-[10px] uppercase truncate max-w-[200px]">{horse.jockey} / {horse.trainer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <LayoutGrid className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-[10px] uppercase tracking-widest font-bold">Select a view tab</p>
      </div>
    );
  };

  return (
    <div 
      className="min-h-screen flex flex-col bg-[#02040a] text-slate-100 selection:bg-blue-500/30 overflow-x-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-blue-600/10 backdrop-blur-xl flex flex-col items-center justify-center border-[10px] border-dashed border-blue-500/40 pointer-events-none animate-in fade-in duration-300">
           <div className="w-32 h-32 bg-blue-600 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(37,99,235,0.6)] ring-4 ring-white/20 animate-bounce">
              <FileUp className="w-16 h-16 text-white" />
           </div>
           <h2 className="mt-12 text-5xl font-black uppercase tracking-tighter text-white shadow-2xl">Drop Master PDF</h2>
           <p className="mt-4 text-blue-400 font-black uppercase tracking-[0.4em] animate-pulse">Neural Parsing Environment Ready</p>
        </div>
      )}

      <header className="bg-slate-900/60 border-b border-slate-800/60 backdrop-blur-2xl sticky top-0 z-50 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
        <div className="max-w-screen-2xl mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-violet-600 rounded-xl flex items-center justify-center shadow-[0_0_25px_rgba(37,99,235,0.4)] ring-1 ring-white/10 transition-transform hover:scale-110 active:scale-95">
              <TrendingUp className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter text-white">RaceWise AI <span className="text-blue-500">Toolbox</span></h1>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-[0.3em] flex items-center gap-1.5">
                <Cpu className="w-2.5 h-2.5 text-violet-500" /> Quantum Inspired Models
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6">
             {isOTBScraping && (
                <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 rounded-lg border border-amber-500/20 animate-pulse">
                   <Globe className="w-3.5 h-3.5 text-amber-500" />
                   <span className="text-[9px] font-black text-amber-400 uppercase">Market Sync...</span>
                </div>
             )}
             <div className="flex items-center gap-3 px-5 py-2 bg-blue-500/5 rounded-full border border-blue-500/20 transition-all hover:bg-blue-500/10 hover:border-blue-500/40">
              <Database className={`w-4 h-4 ${dbStatus === 'synced' ? 'text-blue-400' : 'text-slate-600'}`} />
              <span className="text-[10px] font-black uppercase text-blue-400/90 tracking-widest">{dbStatus === 'synced' ? 'SYNCED' : 'READY'}</span>
            </div>
          </div>
        </div>
        <div className={`h-[2px] bg-gradient-to-r from-blue-600 to-violet-600 shadow-[0_0_15px_#2563eb] transition-all`} style={{ width: `${progress}%` }} />
      </header>

      <main className="flex-1 max-w-screen-2xl mx-auto w-full p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* COLUMN 1: CONTROLS */}
        <div className="lg:col-span-3 space-y-8">
          <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800/80 shadow-2xl">
            {(['morning_card', 'digest', 'entry', 'drf', 'live'] as ToolMode[]).map(mode => (
              <button 
                key={mode} 
                onClick={() => setToolMode(mode)} 
                className={`flex-1 py-2 text-[8px] font-black uppercase rounded-lg transition-all hover:scale-[1.02] active:scale-[0.98] outline-none focus:ring-2 focus:ring-blue-500 ${toolMode === mode ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)]' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/40'}`}
              >
                {mode === 'morning_card' ? '1. MORNING' : mode === 'digest' ? '2. TRD' : mode === 'entry' ? 'Backup' : mode === 'drf' ? 'DRF' : '3. LIVE'}
              </button>
            ))}
          </div>

          <section className="bg-slate-900/40 border border-slate-800/60 rounded-[2rem] p-6 backdrop-blur-2xl space-y-6 shadow-6xl relative overflow-hidden group/inputcard">
             <div className="space-y-4">
                <div className="relative group">
                  <select 
                    value={selectedTrackId} 
                    onChange={(e) => setSelectedTrackId(e.target.value)} 
                    className="w-full h-12 bg-slate-950/60 border border-slate-800/80 rounded-xl px-4 text-[10px] font-black appearance-none outline-none focus:ring-4 focus:ring-blue-500/30 focus:border-blue-500/50 transition-all cursor-pointer hover:bg-slate-950/80"
                  >
                    {TRACKS.map(t => <option key={t.id} value={t.id} className="bg-slate-900">{t.name}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-700 pointer-events-none group-hover:text-blue-500 transition-colors" />
                </div>

                <div 
                  className={`relative group cursor-pointer transition-all duration-500 ${isDragging ? 'scale-[1.02] ring-2 ring-blue-500/40' : ''}`}
                  onClick={() => !selectedFile && fileInputRef.current?.click()}
                >
                  <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept=".pdf" />
                  <textarea 
                    value={inputText} 
                    onChange={(e) => setInputText(e.target.value)} 
                    placeholder="Enter Card Data or Drag PDF here..." 
                    className="w-full h-64 bg-slate-950/60 border border-slate-800 rounded-2xl p-6 text-xs font-mono outline-none focus:border-blue-500/60 focus:ring-4 focus:ring-blue-500/20 transition-all resize-none scrollbar-hide hover:bg-slate-950/80" 
                  />
                  
                  {selectedFile && (
                    <div className="absolute inset-2 bg-slate-950/95 border border-blue-500/20 rounded-2xl flex flex-col items-center justify-center gap-4 backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-300 shadow-2xl">
                      <div className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center border border-blue-500/20 shadow-[0_0_20px_rgba(37,99,235,0.15)]">
                        <FileText className="w-6 h-6 text-blue-400" />
                      </div>
                      <div className="text-center px-4">
                        <p className="text-[10px] font-black uppercase text-white truncate max-w-[200px]">{selectedFile.file.name}</p>
                        <p className="text-[8px] font-black text-blue-500/60 uppercase tracking-widest mt-1">Quantum Parsing Ready</p>
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }} 
                        className="text-[9px] font-black text-red-500 uppercase tracking-widest px-4 py-2 hover:bg-red-500/10 rounded-lg transition-all mt-2 active:scale-95 focus:ring-2 focus:ring-red-500 outline-none"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  {!selectedFile && !inputText.trim() && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-20 group-hover:opacity-60 transition-all">
                       <div className="relative mb-4">
                          <FileUp className="w-8 h-8 group-hover:scale-110 transition-transform text-blue-400" />
                          <MousePointer2 className="absolute -right-2 -bottom-2 w-4 h-4 text-violet-500 animate-pulse" />
                       </div>
                       <p className="text-[10px] font-black uppercase tracking-widest text-center">Drag PDF Here or<br/>Click to Upload</p>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-2">
                     <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                     <p className="text-[9px] font-black text-red-500 uppercase leading-relaxed">{error}</p>
                  </div>
                )}
                
                <button 
                  onClick={handleRunTool} 
                  disabled={isProcessing} 
                  className={`w-full h-14 font-black uppercase text-[10px] rounded-2xl transition-all shadow-4xl flex items-center justify-center gap-3 active:scale-95 hover:scale-[1.02] hover:brightness-110 disabled:opacity-40 disabled:hover:scale-100 focus:ring-4 focus:ring-blue-500/40 outline-none ${toolMode === 'morning_card' ? 'bg-blue-600 shadow-blue-900/40' : toolMode === 'digest' ? 'bg-violet-600 shadow-violet-900/40' : toolMode === 'drf' ? 'bg-emerald-600 shadow-emerald-900/40' : 'bg-slate-800'} text-white shadow-[0_8px_30px_rgba(0,0,0,0.4)]`}
                >
                  {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : toolMode === 'morning_card' ? 'Quantum Morning Report' : toolMode === 'drf' ? 'Execute DRF Analysis' : 'Execute Hybrid Pipeline'}
                </button>

                {toolMode === 'morning_card' && (
                  <button 
                    onClick={() => handleScrapeOTB(false)} 
                    disabled={isOTBScraping} 
                    className="w-full h-12 border border-slate-800 bg-slate-900/60 rounded-xl text-[9px] font-black uppercase text-amber-500 hover:bg-amber-500/10 hover:border-amber-500/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98] focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    {isOTBScraping ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Scrape Market Baseline
                  </button>
                )}
             </div>
          </section>

          <button 
            onClick={handlePushToSupabase} 
            disabled={!result || isSyncingDB} 
            className={`w-full py-4 rounded-xl text-[11px] font-black uppercase transition-all flex items-center justify-center gap-3 border shadow-xl active:scale-[0.98] hover:scale-[1.02] focus:ring-4 focus:ring-blue-500/40 outline-none ${dbStatus === 'synced' ? 'bg-blue-600 text-white border-blue-400 shadow-blue-500/20' : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-blue-400 hover:border-blue-500/40'} disabled:opacity-30 disabled:hover:scale-100`}
          >
             {isSyncingDB ? (
               <><RefreshCw className="w-4 h-4 animate-spin" /> SYNCING ENSEMBLE...</>
             ) : dbStatus === 'synced' ? (
               <><CheckCircle className="w-4 h-4" /> QUANTUM SYNCED</>
             ) : (
               <><Cloud className="w-4 h-4" /> LOAD TO SUPABASE</>
             )}
          </button>
        </div>

        {/* COLUMN 2: ANALYSIS & RESULTS */}
        <div className="lg:col-span-6 flex flex-col gap-8">
          {!result && !isProcessing ? (
            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-800/60 rounded-[3rem] p-12 bg-slate-900/10 backdrop-blur-sm group/mainpanel hover:border-blue-500/20 transition-all">
              <Zap className="w-12 h-12 text-blue-600/40 mb-8 animate-pulse shadow-[0_0_30px_rgba(37,99,235,0.2)] group-hover/mainpanel:scale-110 transition-transform" />
              <h2 className="text-3xl font-black text-slate-500 uppercase tracking-tighter text-center">Professional Handicapping <br/><span className="text-blue-600/60">Neural Engine</span></h2>
              <p className="text-[10px] text-slate-600 font-bold uppercase mt-6 tracking-[0.3em] text-center max-w-sm">Use Automated Morning Reports to scrape live OTB data and enrich it with TRD Ensemble Rankings.</p>
            </div>
          ) : isProcessing ? (
            <div className="flex-1 flex flex-col items-center justify-center border border-slate-800 rounded-[3rem] bg-slate-900/20 backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-500 shadow-6xl">
               {progress === 100 ? (
                 <>
                   <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center border border-blue-500/40 mb-8 animate-bounce shadow-[0_0_30px_rgba(37,99,235,0.3)]">
                     <CheckCircle className="w-10 h-10 text-blue-400" />
                   </div>
                   <h2 className="text-2xl font-black uppercase tracking-tighter text-blue-400">Sync Complete.</h2>
                 </>
               ) : (
                 <>
                   <div className="relative w-24 h-24 mb-10">
                     <RefreshCw className="w-24 h-24 text-blue-500 animate-spin opacity-20" />
                     <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xl font-black text-white">{progress}%</span>
                     </div>
                   </div>
                   <h2 className="text-xl font-black uppercase tracking-widest text-slate-100">{statusMessage}</h2>
                   <div className="w-64 h-1 bg-slate-800 rounded-full mt-6 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-blue-600 to-violet-600 transition-all duration-300" style={{ width: `${progress}%` }} />
                   </div>
                 </>
               )}
            </div>
          ) : result && (
            <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
               <div className="bg-slate-900/60 border border-slate-800 rounded-[2.5rem] p-8 flex items-center justify-between border-l-8 border-l-blue-600 shadow-6xl backdrop-blur-3xl relative overflow-hidden group">
                  <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <div className="flex flex-col relative z-10">
                    <h2 className="text-4xl font-black uppercase tracking-tighter text-white leading-none group-hover:text-blue-400 transition-colors">{result.track}</h2>
                    <p className="text-blue-400 font-black text-xs uppercase mt-3 tracking-widest flex items-center gap-2">
                       <Award className="w-3.5 h-3.5 text-violet-500" /> {result.date} • {result.races.length} MASTER RACES CALCULATED
                    </p>
                  </div>
                  <div className="flex gap-2 relative z-10">
                    <button 
                      onClick={handleShare}
                      title="Share Analysis"
                      className="p-4 bg-slate-800 rounded-xl border border-slate-700 hover:text-blue-400 hover:border-blue-500/50 hover:bg-slate-700/50 transition-all shadow-xl active:scale-95 group/btn relative focus:ring-4 focus:ring-blue-500/40 outline-none"
                    >
                      {shareStatus === 'copied' ? <Check className="w-5 h-5 text-green-400" /> : <Share2 className="w-5 h-5 group-hover/btn:scale-110 transition-transform" />}
                      {shareStatus === 'copied' && (
                        <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-black px-2 py-1 rounded shadow-xl uppercase tracking-widest">Copied</span>
                      )}
                    </button>
                    <button 
                      onClick={() => downloadFile(convertToCSV(result), 'quantum_card.csv', 'text/csv')} 
                      title="Download CSV"
                      className="p-4 bg-slate-800 rounded-xl border border-slate-700 hover:text-blue-400 hover:border-blue-500/50 hover:bg-slate-700/50 transition-all shadow-xl active:scale-95 group/btn focus:ring-4 focus:ring-blue-500/40 outline-none"
                    >
                      <Download className="w-5 h-5 group-hover/btn:scale-110 transition-transform" />
                    </button>
                  </div>
               </div>

               <div className="bg-slate-900/60 border border-slate-800 rounded-[2rem] overflow-hidden backdrop-blur-3xl shadow-6xl">
                  <div className="flex border-b border-slate-800 bg-slate-900/80 p-1">
                    {(['preview', 'betting_sheet', 'rankings', 'csv', 'betting_table', 'xml'] as ActiveTab[]).map(tab => (
                      <button 
                        key={tab} 
                        onClick={() => setActiveTab(tab)} 
                        className={`flex-1 py-4 text-[9px] font-black uppercase tracking-[0.2em] transition-all relative rounded-xl hover:bg-slate-800/60 focus:ring-2 focus:ring-blue-500 outline-none ${activeTab === tab ? 'text-blue-400 bg-blue-500/10 shadow-inner' : 'text-slate-500 hover:text-slate-200'}`}
                      >
                        {tab.replace('_', ' ')}
                        {activeTab === tab && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-gradient-to-r from-blue-600 to-violet-600 rounded-full" />}
                      </button>
                    ))}
                  </div>

                  <div className="max-h-[1000px] overflow-y-auto p-8 custom-scrollbar bg-slate-950/40">
                    {renderTabContent()}
                  </div>
               </div>
            </div>
          )}
        </div>

        {/* COLUMN 3: MARKET FEED PANEL */}
        <div className="lg:col-span-3">
          <section className="bg-slate-900/60 border border-slate-800/80 rounded-[2.5rem] h-full overflow-hidden flex flex-col shadow-6xl sticky top-24 group/panel">
             <div className="p-6 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between group/header">
                <div>
                   <h3 className="text-xs font-black uppercase text-blue-500 tracking-widest flex items-center gap-2">
                     <Layers className="w-3.5 h-3.5 group-hover/header:rotate-180 transition-transform duration-500 text-violet-500" /> MARKET FEED
                   </h3>
                   <p className="text-[9px] text-slate-600 font-bold uppercase mt-1">OTB Dashboard Sync Active</p>
                </div>
                {otbReference && <button onClick={() => setOtbReference(null)} className="text-slate-700 hover:text-red-500 transition-colors active:scale-90 focus:ring-2 focus:ring-red-500 outline-none"><XCircle className="w-4 h-4" /></button>}
             </div>
             <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-950/20">
                {!otbReference ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-4 opacity-40">
                     <Globe className="w-8 h-8 text-slate-700 mb-4 group-hover/panel:scale-110 transition-transform text-blue-900" />
                     <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest leading-relaxed">Run Quantum Morning Report to scrape live entries from offtrackbetting.com.</p>
                  </div>
                ) : (
                  <div className="space-y-8 animate-in slide-in-from-right duration-500">
                    <div className="bg-blue-600/5 border border-blue-500/20 p-4 rounded-xl shadow-inner">
                       <p className="text-[8px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-2">
                          <CheckCircle2 className="w-2.5 h-2.5" /> OTB Source Synced
                       </p>
                       <p className="text-[7px] text-slate-500 font-bold uppercase mt-1">Last Sync: {new Date(otbReference.scrapedAt).toLocaleTimeString()}</p>
                    </div>
                    {/* Render Scraped Races (assume logic from types.ts) */}
                  </div>
                )}
             </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
