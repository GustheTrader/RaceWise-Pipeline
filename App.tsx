
import React, { useState, useCallback, useEffect } from 'react';
import { parseRacingDigest, syncLiveDataFromWeb } from './services/geminiService';
import { PipelineResult, Race, Horse } from './types';
import { convertToCSV, convertToXML, downloadFile, fileToBase64 } from './utils';
import { supabase, persistRaceData } from './services/supabaseClient';
import { 
  TrendingUp,
  History,
  Globe,
  Clock,
  Search,
  Zap,
  RefreshCw,
  ChevronDown,
  MapPin,
  Database,
  CloudUpload,
  Activity,
  User,
  Briefcase,
  ExternalLink,
  Download,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';

const TRACKS = [
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

const App: React.FC = () => {
  const [inputText, setInputText] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<{ file: File; base64: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSyncingDB, setIsSyncingDB] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'csv' | 'xml'>('preview');
  const [ingestMode, setIngestMode] = useState<'digest' | 'live'>('digest');
  const [selectedTrackId, setSelectedTrackId] = useState<string>(TRACKS[0].id);
  const [customTrackName, setCustomTrackName] = useState<string>('');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<'idle' | 'synced' | 'error'>('idle');

  const getEffectiveTrackName = () => {
    if (selectedTrackId === 'custom') return customTrackName;
    return TRACKS.find(t => t.id === selectedTrackId)?.name || '';
  };

  const sanitizeFilename = (text: string) => {
    return text.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
  };

  const handleProcess = async () => {
    if (!inputText.trim() && !selectedFile) return;
    setIsProcessing(true);
    setError(null);
    try {
      const request = selectedFile 
        ? { pdfData: { data: selectedFile.base64, mimeType: selectedFile.file.type } }
        : { text: inputText };
      const data = await parseRacingDigest(request);
      setResult(data);
      setDbStatus('idle');
    } catch (err) {
      setError('Pipeline processing failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLiveSync = async () => {
    const trackName = getEffectiveTrackName();
    if (!trackName) {
      setError('Select a track.');
      return;
    }
    setIsProcessing(true);
    setError(null);
    try {
      const data = await syncLiveDataFromWeb(trackName);
      setResult(data);
      setLastSync(new Date().toLocaleTimeString());
      setDbStatus('idle');
    } catch (err) {
      setError('Live sync failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePushToSupabase = async () => {
    if (!result) return;
    setIsSyncingDB(true);
    try {
      // Mapping to a flat structure for DB ingestion
      const payload = result.races.flatMap(r => r.horses.map(h => ({
        race_id: `${sanitizeFilename(result.track)}_${result.date}_R${r.number}`,
        track: result.track,
        date: result.date,
        race_num: r.number,
        horse_name: h.name,
        program_num: h.programNumber,
        fire_rating: h.fire,
        cpr_rating: h.cpr,
        fast_fig: h.fastFig,
        consensus: h.consensus,
        ml_odds: h.morningLine || '10-1',
        jockey: h.jockey,
        trainer: h.trainer,
        synced_at: new Date().toISOString()
      })));

      await persistRaceData(payload);
      setDbStatus('synced');
    } catch (err) {
      console.error(err);
      setDbStatus('error');
    } finally {
      setIsSyncingDB(false);
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files?.[0]) {
      const file = files[0];
      if (file.type === 'application/pdf') {
        const base64 = await fileToBase64(file);
        setSelectedFile({ file, base64 });
        setIngestMode('digest');
      } else {
        const text = await file.text();
        setInputText(text);
        setIngestMode('digest');
      }
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500/30">
      <header className="bg-slate-900/50 border-b border-slate-800 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
              <TrendingUp className="text-slate-950 w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">RaceWise AI</h1>
              <p className="text-[10px] text-slate-500 font-black tracking-[0.2em] uppercase">Supabase Hybrid Pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-slate-950/50 rounded-full border border-slate-800">
              <Database className={`w-3.5 h-3.5 ${dbStatus === 'synced' ? 'text-emerald-400' : 'text-slate-500'}`} />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">DB: {dbStatus.toUpperCase()}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-8 gap-8 grid grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button onClick={() => setIngestMode('digest')} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${ingestMode === 'digest' ? 'bg-slate-800 text-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}>PDF Digest</button>
            <button onClick={() => setIngestMode('live')} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${ingestMode === 'live' ? 'bg-slate-800 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}>Live Lobby</button>
          </div>

          <section 
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xl relative"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
             <div className="p-4 flex flex-col gap-4">
              {ingestMode === 'digest' ? (
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Paste Digest text or drop PDF..."
                  className="w-full h-80 bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm font-mono outline-none transition-all resize-none bg-transparent focus:border-emerald-500/50"
                />
              ) : (
                <div className="h-80 flex flex-col gap-4">
                  <div className="p-6 bg-slate-950 border border-slate-800 rounded-xl text-center flex-1 flex flex-col items-center justify-center border-l-4 border-l-amber-500 shadow-inner">
                    <Globe className="w-8 h-8 text-amber-400 mb-3 animate-pulse" />
                    <h3 className="text-sm font-black uppercase text-slate-100 tracking-tight">Stream Connector</h3>
                    <p className="text-[9px] text-slate-500 font-bold uppercase mt-1 tracking-widest leading-relaxed">Collecting Morning Lines &<br/>Live Odds Ingestion</p>
                  </div>
                  <div className="space-y-3">
                    <div className="relative">
                      <select 
                        value={selectedTrackId}
                        onChange={(e) => setSelectedTrackId(e.target.value)}
                        className="w-full h-12 bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 text-xs font-bold appearance-none cursor-pointer focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
                      >
                        {TRACKS.map(track => (
                          <option key={track.id} value={track.id} className="bg-slate-900">{track.name} ({track.status})</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    </div>
                  </div>
                </div>
              )}
              <button 
                onClick={ingestMode === 'digest' ? handleProcess : handleLiveSync} 
                disabled={isProcessing} 
                className={`w-full h-12 font-black uppercase text-xs rounded-xl shadow-lg transition-all active:scale-95 ${ingestMode === 'digest' ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-amber-500 text-slate-950 hover:bg-amber-400'} disabled:opacity-50`}
              >
                {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin mx-auto" /> : (ingestMode === 'digest' ? 'Run AM Pipeline' : 'Sync Live Odds')}
              </button>
             </div>
             {isDragging && (
                <div className="absolute inset-0 bg-emerald-500/10 border-2 border-dashed border-emerald-500 rounded-2xl flex items-center justify-center z-10 backdrop-blur-sm">
                  <p className="font-black text-xs uppercase tracking-[0.2em] text-emerald-400">Release Digest File</p>
                </div>
             )}
          </section>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
             <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Supabase Engine</span>
                <span className={`flex h-2 w-2 rounded-full ${dbStatus === 'synced' ? 'bg-emerald-500' : 'bg-slate-700'} animate-pulse`}></span>
             </div>
             <button 
                onClick={handlePushToSupabase}
                disabled={!result || isSyncingDB}
                className="w-full py-3 bg-slate-950 border border-slate-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-emerald-400 hover:border-emerald-500/50 transition-all disabled:opacity-30 disabled:hover:text-slate-400 flex items-center justify-center gap-2"
              >
                {isSyncingDB ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CloudUpload className="w-3 h-3" />}
                Push Data to DB
              </button>
          </div>
        </div>

        <div className="lg:col-span-8 flex flex-col">
          {!result && !isProcessing && (
            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-3xl p-12 text-center bg-slate-900/10">
              <Zap className="w-16 h-16 text-slate-800 mb-6" />
              <h2 className="text-xl font-black text-slate-400 uppercase tracking-widest">Pipeline Ready</h2>
              <p className="text-xs text-slate-600 font-bold uppercase mt-2">Connect to the stream to start handicapping.</p>
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex items-center justify-between gap-4 border-l-4 border-l-emerald-500 shadow-xl">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                    <Activity className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight">{result.track}</h2>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-emerald-400 font-black text-[10px] uppercase tracking-widest">{result.date}</p>
                      <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                      <p className="text-slate-500 font-black text-[10px] uppercase tracking-widest">{result.races.length} Races Active</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => downloadFile(convertToCSV(result), `${sanitizeFilename(result.track)}_stats.csv`, 'text/csv')} className="px-4 py-2 bg-slate-800 text-emerald-400 rounded-lg text-[10px] font-black uppercase hover:bg-slate-700"><Download className="inline w-3 h-3 mr-1" /> CSV</button>
                  <button onClick={() => downloadFile(convertToXML(result), `${sanitizeFilename(result.track)}_card.xml`, 'application/xml')} className="px-4 py-2 bg-emerald-500 text-slate-950 rounded-lg text-[10px] font-black uppercase hover:bg-emerald-400"><Download className="inline w-3 h-3 mr-1" /> XML</button>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex border-b border-slate-800 bg-slate-900/40">
                  {(['preview', 'csv', 'xml'] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-6 py-4 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-500 hover:text-slate-300'}`}>{tab}</button>
                  ))}
                </div>

                <div className="max-h-[700px] overflow-y-auto custom-scrollbar p-6">
                  {activeTab === 'preview' && (
                    <div className="space-y-8">
                      {result.races.map((race) => (
                        <div key={race.number} className="space-y-4">
                          <div className="flex items-center gap-3 border-b border-slate-800 pb-2">
                            <span className="text-emerald-400 font-black text-xl">#{race.number}</span>
                            <h3 className="font-black text-sm uppercase text-slate-400 tracking-widest">{race.distance} • {race.surface}</h3>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {race.horses.map((horse) => (
                              <div key={horse.programNumber} className="bg-slate-950/50 border border-slate-800 p-4 rounded-xl hover:border-emerald-500/30 transition-all group">
                                <div className="flex justify-between items-start mb-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded bg-slate-900 border border-slate-800 flex items-center justify-center font-black text-slate-500">{horse.programNumber}</div>
                                    <div>
                                      <h4 className="font-black text-sm uppercase text-slate-100 group-hover:text-emerald-400 transition-colors">{horse.name}</h4>
                                      <p className="text-[9px] text-slate-500 font-bold uppercase">{horse.jockey} / {horse.trainer}</p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-[8px] text-slate-600 font-black uppercase">Morning Line</p>
                                    <p className="text-xs font-black text-amber-500">{horse.morningLine || '10-1'}</p>
                                  </div>
                                </div>
                                <div className="grid grid-cols-4 gap-2 border-t border-slate-800 pt-3">
                                  <div className="text-center">
                                    <p className="text-[7px] text-slate-600 font-black uppercase">FIRE</p>
                                    <p className="text-[11px] font-black text-orange-400">{horse.fire}</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[7px] text-slate-600 font-black uppercase">CPR</p>
                                    <p className="text-[11px] font-black text-blue-400">{horse.cpr}</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[7px] text-slate-600 font-black uppercase">FAST</p>
                                    <p className="text-[11px] font-black text-emerald-400">{horse.fastFig}</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[7px] text-slate-600 font-black uppercase">LIVE</p>
                                    <div className="flex items-center justify-center gap-1">
                                      <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                                      <p className="text-[11px] font-black text-slate-200">{horse.liveOdds || '??'}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeTab === 'csv' && <pre className="text-[11px] text-emerald-400 font-mono">{convertToCSV(result)}</pre>}
                  {activeTab === 'xml' && <pre className="text-[11px] text-amber-400 font-mono">{convertToXML(result)}</pre>}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-800 bg-slate-900/90 p-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 opacity-50">
          <div className="flex items-center gap-4">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">&copy; 2025 Rasewiseai.com • Hybrid Pipeline v2.1</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Handicapping Stream Online</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
