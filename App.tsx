import React, { useState, useCallback, useRef, useEffect } from 'react';
import { parseRacingDigest, parseBackupEntries, syncLiveDataFromWeb, parseMorningCard, scrapeOTBData } from './services/geminiService';
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

type ToolMode = 'morning_card' | 'digest' | 'entry' | 'live';
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
  const sanitizeFilename = (text: string) => text.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');

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
    if (toolMode !== 'live' && !inputText.trim() && !selectedFile) return;
    setIsProcessing(true);
    setError(null);
    const trackName = getEffectiveTrackName();
    
    try {
      let data: PipelineResult;
      const inputMethodPrefix = selectedFile ? "Quantum Parsing: " : "Model Sync: ";

      if (toolMode === 'morning_card') {
        startProgress(`${inputMethodPrefix}Morning Card & OTB Market Sync...`);
        handleScrapeOTB(true);
        const request = selectedFile ? { pdfData: { data: selectedFile.base64, mimeType: selectedFile.file.type } } : { text: inputText };
        data = await parseMorningCard(request);
        if (!data.track || data.track.toLowerCase().includes('unknown')) data.track = trackName;
      } else if (toolMode === 'digest') {
        startProgress(`${inputMethodPrefix}TRD Hybrid Neural Ensemble...`);
        const request = selectedFile ? { pdfData: { data: selectedFile.base64, mimeType: selectedFile.file.type } } : { text: inputText };
        data = await parseRacingDigest(request);
      } else if (toolMode === 'entry') {
        startProgress(`${inputMethodPrefix}Syncing Backup Master Card...`);
        const request = selectedFile ? { pdfData: { data: selectedFile.base64, mimeType: selectedFile.file.type } } : { text: inputText };
        data = await parseBackupEntries(request);
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
    if (typeof err === 'string') return err;
    if (err.message && err.details) return `${err.message}: ${err.details}`;
    if (err.message) return err.message;
    return JSON.stringify(err);
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
          // Ensure complex objects are handled if needed, usually Supabase JSONB handles them
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
      try {
        await navigator.share({
          title: `RaceWise AI - ${result.track}`,
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        console.debug('Share API cancelled or failed', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n\nLink: ${shareUrl}`);
        setShareStatus('copied');
        setTimeout(() => setShareStatus('idle'), 2000);
      } catch (err) {
        console.error('Clipboard copy failed', err);
      }
    }
  };

  const getTopSixWithTies = (horses: Horse[]) => {
    const sorted = [...horses].sort((a, b) => b.modelScore - a.modelScore);
    if (sorted.length <= 6) return sorted;
    const cutoffScore = sorted[5].modelScore;
    return sorted.filter((h, idx) => idx < 6 || h.modelScore === cutoffScore);
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
            {(['morning_card', 'digest', 'entry', 'live'] as ToolMode[]).map(mode => (
              <button 
                key={mode} 
                onClick={() => setToolMode(mode)} 
                className={`flex-1 py-2 text-[8px] font-black uppercase rounded-lg transition-all hover:scale-[1.02] active:scale-[0.98] outline-none focus:ring-2 focus:ring-blue-500 ${toolMode === mode ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)]' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800/40'}`}
              >
                {mode === 'morning_card' ? '1. MORNING' : mode === 'digest' ? '2. TRD' : mode === 'entry' ? 'Backup' : '3. LIVE'}
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
                  <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-2">
                     <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                     <p className="text-[9px] font-black text-red-500 uppercase leading-tight">{error}</p>
                  </div>
                )}
                
                <button 
                  onClick={handleRunTool} 
                  disabled={isProcessing || (!inputText.trim() && !selectedFile && toolMode !== 'live')} 
                  className={`w-full h-14 font-black uppercase text-[10px] rounded-2xl transition-all shadow-4xl flex items-center justify-center gap-3 active:scale-95 hover:scale-[1.02] hover:brightness-110 disabled:opacity-40 disabled:hover:scale-100 focus:ring-4 focus:ring-blue-500/40 outline-none ${toolMode === 'morning_card' ? 'bg-blue-600 shadow-blue-900/40' : toolMode === 'digest' ? 'bg-violet-600 shadow-violet-900/40' : 'bg-slate-800'} text-white shadow-[0_8px_30px_rgba(0,0,0,0.4)]`}
                >
                  {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : toolMode === 'morning_card' ? 'Quantum Morning Report' : 'Execute Hybrid Pipeline'}
                </button>

                {toolMode === 'morning_card' && (
                  <button 
                    onClick={() => handleScrapeOTB(false)} 
                    disabled={isOTBScraping} 
                    className="w-full h-12 border border-slate-800 bg-slate-900/60 rounded-xl text-[9px] font-black uppercase text-amber-500 hover:bg-amber-500/10 hover:border-amber-500/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98] focus:ring-2 focus:ring-amber-500 outline-none"
                  >
                    {isOTBScraping ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />} Scrape Market Odds
                  </button>
                )}
             </div>
          </section>

          {toolMode === 'digest' && (
            <section className="bg-slate-900/80 border border-blue-500/20 rounded-[2rem] p-6 backdrop-blur-3xl space-y-4 shadow-6xl animate-in zoom-in-95 duration-500">
               <div className="flex items-center gap-3 mb-2">
                  <div className="p-2 bg-blue-600/10 rounded-lg">
                    <Info className="w-4 h-4 text-blue-400" />
                  </div>
                  <h3 className="text-[10px] font-black uppercase text-white tracking-widest">Model Architecture v3.7.0</h3>
               </div>
               <div className="space-y-3">
                  {[
                    { label: 'Quantum Fire Figure', val: 20.00, color: 'bg-red-600' },
                    { label: 'CatBoost Regressor', val: 15.40, color: 'bg-blue-600' },
                    { label: 'Jockey Win Power', val: 12.00, color: 'bg-indigo-600' },
                    { label: 'Trainer Win Power', val: 12.00, color: 'bg-indigo-400' },
                    { label: 'HC 20 Longshot', val: 12.00, color: 'bg-amber-600' },
                    { label: 'LightGBM Ensemble', val: 11.00, color: 'bg-violet-600' },
                    { label: 'RNN Sequence Engine', val: 6.60, color: 'bg-pink-600' },
                    { label: 'Consensus Hybrid', val: 6.60, color: 'bg-slate-500' },
                    { label: 'XGBoost Factor', val: 4.40, color: 'bg-slate-400' },
                  ].map(m => (
                    <div key={m.label} className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold uppercase tracking-tight">
                        <span className="text-slate-400">{m.label}</span>
                        <span className="text-white">{m.val.toFixed(2)}%</span>
                      </div>
                      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${m.color} transition-all duration-1000`} style={{ width: `${m.val * 3}%` }} />
                      </div>
                    </div>
                  ))}
               </div>
               <div className="pt-4 border-t border-slate-800 mt-2 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[8px] font-black text-blue-400 uppercase tracking-widest">
                    <Zap className="w-3 h-3" /> Class Drop Bonus: +25% Multiplier
                  </div>
                  <div className="flex items-center gap-2 text-[8px] font-black text-amber-500 uppercase tracking-widest">
                    <Star className="w-3 h-3" /> HC 20 Weighting Active
                  </div>
               </div>
            </section>
          )}

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
              <p className="text-[10px] text-slate-600 font-bold uppercase mt-6 tracking-[0.3em] text-center max-w-sm">Drag and drop any Today's Racing Digest PDF to begin the ensemble synchronization.</p>
              <div className="mt-8 flex gap-4">
                 <div className="px-4 py-2 bg-blue-500/5 rounded-lg border border-blue-500/10 text-[8px] font-black text-blue-500 uppercase tracking-widest">Supports PDF Uploads</div>
                 <div className="px-4 py-2 bg-violet-500/5 rounded-lg border border-violet-500/10 text-[8px] font-black text-violet-500 uppercase tracking-widest">Drag & Drop Active</div>
              </div>
            </div>
          ) : isProcessing ? (
            <div className="flex-1 flex flex-col items-center justify-center border border-slate-800 rounded-[3rem] bg-slate-900/20 backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-500 shadow-6xl">
               {progress === 100 ? (
                 <>
                   <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center border border-blue-500/40 mb-8 animate-bounce shadow-[0_0_30px_rgba(37,99,235,0.3)]">
                     <CheckCircle className="w-10 h-10 text-blue-400" />
                   </div>
                   <h2 className="text-2xl font-black uppercase tracking-tighter text-blue-400">Sync Complete.</h2>
                   <p className="text-[10px] text-slate-500 font-bold uppercase mt-4 tracking-widest">Compiling Neural Probabilities...</p>
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

               {result.groundingSources && result.groundingSources.length > 0 && (
                 <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6 backdrop-blur-2xl shadow-6xl">
                    <h3 className="text-[10px] font-black uppercase text-blue-500 tracking-widest mb-4 flex items-center gap-2">
                      <Globe className="w-4 h-4 text-violet-500" /> Verified Market Citations
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {result.groundingSources.map((source, idx) => (
                        <a 
                          key={idx} 
                          href={source.uri} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-blue-500/5 border border-blue-500/20 rounded-lg text-[9px] font-black text-blue-400 hover:bg-blue-500/15 hover:border-blue-500/50 transition-all flex items-center gap-2 group/link focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                          <Share2 className="w-3 h-3 text-slate-500 group-hover/link:text-blue-400 transition-colors" />
                          <span className="truncate max-w-[200px]">{source.title || 'Grounding Source'}</span>
                        </a>
                      ))}
                    </div>
                 </div>
               )}

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
                    {activeTab === 'preview' && (
                       <div className="space-y-12">
                          {result.races.map(race => (
                            <div key={race.number} className="bg-slate-900/60 border border-slate-800 rounded-[2rem] overflow-hidden group/race transition-all hover:border-blue-500/20 shadow-2xl">
                               <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/40">
                                  <div className="flex items-center gap-6">
                                    <span className="bg-blue-600 text-white font-black text-xl w-12 h-12 flex items-center justify-center rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.3)] group-hover/race:scale-105 transition-transform">R{race.number}</span>
                                    <div>
                                       <h3 className="font-black text-base uppercase text-slate-100 tracking-tighter">{race.distance} • {race.surface}</h3>
                                       <p className="text-[8px] font-black text-blue-500/60 uppercase tracking-widest mt-1">Neural field analysis active</p>
                                    </div>
                                  </div>
                               </div>
                               <div className="p-6 space-y-3">
                                  {race.horses.slice(0, 5).map((horse, idx) => {
                                     const isHC20 = (horse.hf || "").includes("20");
                                     return (
                                        <div 
                                          key={horse.programNumber} 
                                          className={`flex flex-col gap-3 p-4 rounded-xl border transition-all hover:scale-[1.01] ${idx === 0 ? 'bg-blue-600/10 border-blue-500/30 ring-1 ring-blue-500/40 shadow-[0_0_25px_rgba(37,99,235,0.1)]' : 'bg-slate-950/60 border-slate-800 hover:border-slate-600'}`}
                                        >
                                           <div className="flex items-center justify-between">
                                             <div className="flex items-center gap-6">
                                                <span className={`text-lg font-black ${idx === 0 ? 'text-amber-500' : 'text-slate-600'}`}>{horse.programNumber}</span>
                                                <div>
                                                  <div className="flex items-center gap-2">
                                                     <h4 className={`font-black text-sm uppercase leading-none ${idx === 0 ? 'text-blue-400' : 'text-white'}`}>{horse.name}</h4>
                                                     {isHC20 && <span className="bg-violet-600/20 text-violet-400 text-[8px] font-black px-1.5 py-0.5 rounded border border-violet-500/30 uppercase tracking-widest animate-pulse">Neural Longshot</span>}
                                                  </div>
                                                  <p className="text-[9px] text-slate-500 font-bold uppercase mt-1">J: {horse.jockey} | T: {horse.trainer}</p>
                                                </div>
                                             </div>
                                             <div className="text-right">
                                                <div className="text-blue-500 font-black text-lg leading-none">{horse.modelOdds}</div>
                                                <div className="text-[9px] font-black text-slate-500 uppercase mt-1">Score: {horse.modelScore}</div>
                                             </div>
                                           </div>
                                           
                                           <div className="flex gap-4 border-t border-slate-800 pt-3 mt-1">
                                              <div className="flex items-center gap-2">
                                                <span className="text-[8px] font-black text-slate-500 uppercase">Jockey Win:</span>
                                                <span className="text-[9px] font-black text-blue-400">{horse.jockeyWinRate}%</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-[8px] font-black text-slate-500 uppercase">Trainer Win:</span>
                                                <span className="text-[9px] font-black text-violet-400">{horse.trainerWinRate}%</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-[8px] font-black text-slate-500 uppercase">Fire Figure:</span>
                                                <span className="text-[9px] font-black text-red-400">{horse.fire || 0}</span>
                                              </div>
                                           </div>
                                        </div>
                                     );
                                  })}
                               </div>
                            </div>
                          ))}
                       </div>
                    )}

                    {activeTab === 'betting_sheet' && (
                       <div className="space-y-8">
                          <div className="bg-blue-600/10 border border-blue-500/30 p-6 rounded-2xl flex items-center gap-4 shadow-6xl">
                             <Ticket className="w-6 h-6 text-blue-400" />
                             <div>
                                <h3 className="text-sm font-black uppercase text-white tracking-widest">Master Execution Table</h3>
                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight">Rapid Betting Optimization Interface</p>
                             </div>
                          </div>
                          
                          <div className="space-y-4">
                            {result.races.map(race => (
                              <div key={race.number} className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-6xl hover:border-blue-500/30 transition-colors group/race">
                                <div className="bg-slate-800/60 px-6 py-3 border-b border-slate-700 flex justify-between items-center group-hover/race:bg-slate-800 transition-colors">
                                   <span className="text-sm font-black text-white uppercase tracking-tighter">Race {race.number}</span>
                                   <span className="text-[10px] font-black text-blue-500 uppercase">Top 6 Projections</span>
                                </div>
                                <table className="w-full text-left border-collapse">
                                   <thead>
                                      <tr className="bg-slate-950/60 border-b border-slate-800">
                                         <th className="px-6 py-3 text-[9px] font-black text-slate-500 uppercase">Rank</th>
                                         <th className="px-6 py-3 text-[9px] font-black text-slate-500 uppercase">PP</th>
                                         <th className="px-6 py-3 text-[9px] font-black text-slate-500 uppercase">Horse</th>
                                         <th className="px-6 py-3 text-[9px] font-black text-slate-500 uppercase">Fair Odds</th>
                                         <th className="px-6 py-3 text-[9px] font-black text-slate-500 uppercase text-right">Model Score</th>
                                      </tr>
                                   </thead>
                                   <tbody>
                                      {getTopSixWithTies(race.horses).map((horse, idx) => (
                                         <tr key={horse.programNumber} className={`border-b border-slate-800/50 hover:bg-blue-900/20 transition-all cursor-default ${idx === 0 ? 'bg-blue-600/5' : ''}`}>
                                            <td className="px-6 py-3">
                                               <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black ${idx === 0 ? 'bg-amber-500 text-slate-900 shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'bg-slate-800 text-slate-400'}`}>
                                                  {horse.rank}
                                               </div>
                                            </td>
                                            <td className="px-6 py-3 font-black text-sm text-slate-300">{horse.programNumber}</td>
                                            <td className="px-6 py-3">
                                               <span className={`text-[11px] font-black uppercase ${idx === 0 ? 'text-blue-400' : 'text-slate-100'}`}>{horse.name}</span>
                                            </td>
                                            <td className="px-6 py-3 text-[11px] font-black text-amber-500">{horse.modelOdds}</td>
                                            <td className="px-6 py-3 text-[11px] font-black text-slate-400 text-right">{horse.modelScore}</td>
                                         </tr>
                                      ))}
                                   </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                       </div>
                    )}

                    {activeTab === 'betting_table' && (
                       <div className="space-y-8">
                          <div className="bg-blue-600/10 border border-blue-500/30 p-6 rounded-2xl flex items-center gap-4 shadow-6xl">
                             <Table className="w-6 h-6 text-blue-400" />
                             <div>
                                <h3 className="text-sm font-black uppercase text-white tracking-widest">Betting Table Pro</h3>
                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight">Full Ensemble Data Distribution Matrix</p>
                             </div>
                          </div>
                          
                          <div className="space-y-8">
                            {result.races.map(race => (
                              <div key={race.number} className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-6xl hover:border-blue-500/30 transition-colors">
                                <div className="bg-slate-800/60 px-6 py-4 border-b border-slate-700 flex justify-between items-center">
                                   <span className="text-lg font-black text-white uppercase tracking-tighter">Race {race.number}</span>
                                   <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Ensemble Top Field</span>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse min-w-[1200px]">
                                     <thead>
                                        <tr className="bg-slate-950/60 border-b border-slate-800">
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">Rank</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">PP</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">Horse</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">ML Odds</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">Model Odds</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">Score</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">Win %</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">Jockey Win%</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">Trainer Win%</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">HF String</th>
                                        </tr>
                                     </thead>
                                     <tbody>
                                        {getTopSixWithTies(race.horses).map((horse, idx) => (
                                           <tr key={horse.programNumber} className={`border-b border-slate-800/50 hover:bg-blue-900/20 transition-all cursor-default ${idx === 0 ? 'bg-blue-600/5' : ''}`}>
                                              <td className="px-6 py-4">
                                                 <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black ${idx === 0 ? 'bg-amber-500 text-slate-900 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'bg-slate-800 text-slate-400'}`}>
                                                    {horse.rank}
                                                 </div>
                                              </td>
                                              <td className="px-6 py-4 font-black text-base text-slate-300">{horse.programNumber}</td>
                                              <td className="px-6 py-4">
                                                 <div className="flex flex-col">
                                                   <span className={`text-[12px] font-black uppercase ${idx === 0 ? 'text-blue-400' : 'text-slate-100'}`}>{horse.name}</span>
                                                   <span className="text-[9px] text-slate-600 font-bold uppercase mt-0.5">{horse.jockey} / {horse.trainer}</span>
                                                 </div>
                                              </td>
                                              <td className="px-6 py-4 text-[11px] font-black text-slate-400">{horse.morningLine}</td>
                                              <td className="px-6 py-4 text-[12px] font-black text-amber-500">{horse.modelOdds}</td>
                                              <td className="px-6 py-4 text-[12px] font-black text-slate-300">{horse.modelScore}</td>
                                              <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                   <div className="w-16 h-1 bg-slate-800 rounded-full overflow-hidden">
                                                     <div className="h-full bg-blue-600" style={{ width: `${horse.winPercentage}%` }} />
                                                   </div>
                                                   <span className="text-[11px] font-black text-slate-400">{horse.winPercentage}%</span>
                                                </div>
                                              </td>
                                              <td className="px-6 py-4 text-[11px] font-black text-blue-400/80">{horse.jockeyWinRate}%</td>
                                              <td className="px-6 py-4 text-[11px] font-black text-violet-400/80">{horse.trainerWinRate}%</td>
                                              <td className="px-6 py-4 text-[10px] font-medium text-slate-500 max-w-[200px] truncate" title={horse.hf}>
                                                 {horse.hf || "—"}
                                              </td>
                                           </tr>
                                        ))}
                                     </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                       </div>
                    )}

                    {activeTab === 'rankings' && (
                       <div className="space-y-8">
                          <div className="bg-violet-600/10 border border-violet-500/30 p-6 rounded-2xl flex items-center gap-4 shadow-6xl">
                             <Award className="w-6 h-6 text-violet-400" />
                             <div>
                                <h3 className="text-sm font-black uppercase text-white tracking-widest">Hybrid Neural Rankings</h3>
                                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight">Full Field Probabilistic Distribution</p>
                             </div>
                          </div>
                          
                          <div className="space-y-12">
                            {result.races.map(race => (
                              <div key={race.number} className="space-y-4">
                                <div className="flex items-center gap-4 border-l-4 border-blue-600 pl-4 py-1">
                                   <span className="text-xl font-black text-white">RACE {race.number}</span>
                                   <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{race.distance} • {race.surface}</span>
                                </div>
                                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-6xl transition-all hover:border-blue-500/40">
                                  <table className="w-full text-left border-collapse">
                                     <thead>
                                        <tr className="bg-slate-950/60 border-b border-slate-800">
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase">Rank</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase">PP</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase">Horse</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase">Win %</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase">ML</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase">Fair Odds</th>
                                           <th className="px-6 py-4 text-[9px] font-black text-slate-500 uppercase text-right">Score</th>
                                        </tr>
                                     </thead>
                                     <tbody>
                                        {race.horses.map((horse, idx) => (
                                           <tr key={horse.programNumber} className={`border-b border-slate-800/50 hover:bg-blue-950/30 transition-all cursor-default group/horse ${idx === 0 ? 'bg-blue-600/5' : ''}`}>
                                              <td className="px-6 py-4">
                                                 <span className={`text-[10px] font-black ${idx === 0 ? 'text-amber-500' : 'text-slate-500'}`}>#{horse.rank}</span>
                                              </td>
                                              <td className="px-6 py-4 font-black text-sm text-slate-300">{horse.programNumber}</td>
                                              <td className="px-6 py-4">
                                                 <div className="flex flex-col">
                                                   <span className={`text-[11px] font-black uppercase transition-colors group-hover/horse:text-blue-400 ${idx === 0 ? 'text-blue-400' : 'text-slate-100'}`}>{horse.name}</span>
                                                   <span className="text-[8px] text-slate-600 font-bold uppercase mt-0.5">{horse.jockey} / {horse.trainer}</span>
                                                 </div>
                                              </td>
                                              <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                  <div className="w-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                                                    <div className="h-full bg-blue-600 group-hover/horse:bg-blue-400 transition-colors" style={{ width: `${horse.winPercentage}%` }} />
                                                  </div>
                                                  <span className="text-[10px] font-black text-slate-400">{horse.winPercentage}%</span>
                                                </div>
                                              </td>
                                              <td className="px-6 py-4 text-[10px] font-bold text-slate-500">{horse.morningLine}</td>
                                              <td className="px-6 py-4 text-[11px] font-black text-amber-500">{horse.modelOdds}</td>
                                              <td className="px-6 py-4 text-[11px] font-black text-slate-400 text-right">{horse.modelScore}</td>
                                           </tr>
                                        ))}
                                     </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                       </div>
                    )}

                    {activeTab === 'csv' && <pre className="text-[10px] text-blue-400 font-mono whitespace-pre p-6 bg-slate-950/80 rounded-2xl overflow-x-auto selection:bg-blue-500/40 border border-slate-800">{convertToCSV(result)}</pre>}
                    {activeTab === 'xml' && <pre className="text-[10px] text-violet-400 font-mono whitespace-pre p-6 bg-slate-950/80 rounded-2xl overflow-x-auto selection:bg-violet-500/40 border border-slate-800">{convertToXML(result)}</pre>}
                  </div>
               </div>
            </div>
          )}
        </div>

        {/* COLUMN 3: OTB REFERENCE PANEL */}
        <div className="lg:col-span-3">
          <section className="bg-slate-900/60 border border-slate-800/80 rounded-[2.5rem] h-full overflow-hidden flex flex-col shadow-6xl sticky top-24 group/panel">
             <div className="p-6 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between group/header">
                <div>
                   <h3 className="text-xs font-black uppercase text-blue-500 tracking-widest flex items-center gap-2">
                     <Layers className="w-3.5 h-3.5 group-hover/header:rotate-180 transition-transform duration-500 text-violet-500" /> MARKET FEED
                   </h3>
                   <p className="text-[9px] text-slate-600 font-bold uppercase mt-1">Live Card Dashboard Sync</p>
                </div>
                {otbReference && <button onClick={() => setOtbReference(null)} className="text-slate-700 hover:text-red-500 transition-colors active:scale-90 focus:ring-2 focus:ring-red-500 outline-none"><XCircle className="w-4 h-4" /></button>}
             </div>
             <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-950/20">
                {!otbReference ? (
                  <div className="h-full flex flex-col items-center justify-center text-center px-4 opacity-40">
                     <Globe className="w-8 h-8 text-slate-700 mb-4 group-hover/panel:scale-110 transition-transform text-blue-900" />
                     <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest leading-relaxed">Execute Morning Card to sync the master market feed.</p>
                  </div>
                ) : (
                  <div className="space-y-8 animate-in slide-in-from-right duration-500">
                    <div className="bg-blue-600/5 border border-blue-500/20 p-4 rounded-xl shadow-inner">
                       <p className="text-[8px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-2">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Source Authenticated
                       </p>
                       <p className="text-[7px] text-slate-500 font-bold uppercase mt-1">Last Sync: {new Date(otbReference.scrapedAt).toLocaleTimeString()}</p>
                    </div>
                    {otbReference.races?.map((race: any) => (
                      <div key={race.number} className="space-y-4">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 bg-blue-600/20 border border-blue-500/30 rounded flex items-center justify-center text-[10px] font-black text-blue-400">R{race.number}</span>
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Market Status</span>
                        </div>
                        <div className="space-y-2">
                           {race.horses?.map((horse: any) => (
                             <div key={horse.program} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between group hover:border-blue-500/40 hover:scale-[1.02] transition-all shadow-[0_4px_15px_rgba(0,0,0,0.2)] active:scale-[0.98]">
                                <div className="flex items-center gap-3">
                                   <span className="text-[10px] font-black text-slate-600 group-hover:text-blue-500 transition-colors">{horse.program}</span>
                                   <span className="text-[10px] font-black uppercase text-slate-300 truncate max-w-[100px] group-hover:text-white transition-colors">{horse.name}</span>
                                </div>
                                <span className="text-[11px] font-black text-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.2)]">{horse.ml}</span>
                             </div>
                           ))}
                        </div>
                      </div>
                    ))}
                    {otbReference.groundingSources && otbReference.groundingSources.length > 0 && (
                      <div className="pt-4 border-t border-slate-800 mt-4 space-y-2">
                         <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Market Sources:</p>
                         {otbReference.groundingSources.map((s: any, i: number) => (
                           <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer" className="block text-[8px] text-blue-400 hover:underline truncate group flex items-center gap-2 focus:ring-2 focus:ring-blue-500 outline-none">
                             <Share2 className="w-2.5 h-2.5 opacity-40" /> {s.title || s.uri}
                           </a>
                         ))}
                      </div>
                    )}
                  </div>
                )}
             </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-800 bg-slate-950/90 p-6 backdrop-blur-3xl mt-auto">
        <div className="max-w-screen-2xl mx-auto flex justify-between items-center px-8 text-[9px] font-black uppercase tracking-widest text-slate-600">
           <div className="flex gap-8">
             <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse" /> v3.7.0 MASTER_RANKINGS</span>
             <span className="text-blue-600 font-black">NEURAL_MASTER_SYNC_ACTIVE</span>
           </div>
           <div className="flex items-center gap-6">
             <a href="#" className="hover:text-blue-400 transition-colors focus:ring-2 focus:ring-blue-500 outline-none">Documentation</a>
             <a href="#" className="hover:text-violet-400 transition-colors focus:ring-2 focus:ring-violet-500 outline-none">Quantum Logic</a>
             <span className="text-slate-800">|</span>
             <span>&copy; 2025 RASEWISEAI.COM</span>
           </div>
        </div>
      </footer>
    </div>
  );
};

export default App;