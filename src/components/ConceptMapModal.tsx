import React, { useState, useRef } from 'react';
import {
  X,
  Download,
  Share2,
  Upload,
  Image as ImageIcon,
  FileText,
  Loader2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Layers,
  Network,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

interface ConceptMapNode {
  id: string;
  label: string;
  details?: string;
  subNodes?: string[];
}

interface ConceptMapBranch {
  id: string;
  title: string;
  color: string;
  nodes: ConceptMapNode[];
}

interface ConceptMapData {
  title: string;
  centralConcept: string;
  summary: string;
  branches: ConceptMapBranch[];
  relationships?: {
    from: string;
    to: string;
    label: string;
  }[];
}

export const ConceptMapModal: React.FC = () => {
  const { t, settings } = useAuth();
  const { conceptMapOpen, setConceptMapOpen, pendingAttachments } = useChat();

  const [topic, setTopic] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conceptMap, setConceptMap] = useState<ConceptMapData | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapSvgRef = useRef<SVGSVGElement>(null);

  if (!conceptMapOpen) return null;

  const handleFilesAdded = (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files);
    setSelectedFiles((prev) => [...prev, ...list]);
  };

  const removeSelectedFile = (idx: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleGenerate = async () => {
    if (selectedFiles.length === 0 && !topic.trim()) {
      setErrorMessage('يرجى كتابة موضوع الدرس أو إرفاق صورة/ملف للبدء.');
      return;
    }

    setErrorMessage(null);
    setIsGenerating(true);

    try {
      const formData = new FormData();
      formData.append('topic', topic.trim());
      formData.append('language', settings.uiLanguage || 'ar');

      selectedFiles.forEach((f) => {
        formData.append('files', f);
      });

      const res = await fetch('/api/concept-map/generate', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل توليد خريطة المفاهيم');
      }

      setConceptMap(data.conceptMap);
    } catch (err: any) {
      console.error('Concept map generation error:', err);
      setErrorMessage(err.message || 'حدث خطأ أثناء بناء الخريطة.');
    } finally {
      setIsGenerating(false);
    }
  };

  // High-Resolution Export: converts SVG map into a crisp PNG and triggers save to phone photos
  const handleDownload = async () => {
    if (!mapSvgRef.current) return;
    setIsDownloading(true);

    try {
      const svgElement = mapSvgRef.current;
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgElement);

      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const URLObj = window.URL || window.webkitURL || window;
      const blobUrl = URLObj.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = async () => {
        const scale = 2.5; // High-resolution for crystal clear reading on phone
        const canvas = document.createElement('canvas');
        canvas.width = (svgElement.clientWidth || 1000) * scale;
        canvas.height = (svgElement.clientHeight || 750) * scale;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#171717';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          canvas.toBlob(async (blob) => {
            if (!blob) {
              setIsDownloading(false);
              return;
            }

            const fileName = `StuAI-ConceptMap-${(conceptMap?.centralConcept || 'map').replace(/\s+/g, '_')}.png`;

            // If Web Share API with files is supported (e.g. Mobile Chrome, Safari, Android, iOS)
            // it can save directly to the device photo library!
            const file = new File([blob], fileName, { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              try {
                await navigator.share({
                  files: [file],
                  title: conceptMap?.title || 'خريطة المفاهيم',
                  text: 'خريطة مفاهيم تم إنشاؤها عبر Stu.Ai',
                });
                setIsDownloading(false);
                URLObj.revokeObjectURL(blobUrl);
                return;
              } catch (shareErr) {
                // User cancelled or unsupported, fallback to direct anchor download
              }
            }

            // Fallback direct download
            const link = document.createElement('a');
            link.download = fileName;
            link.href = URLObj.createObjectURL(blob);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URLObj.revokeObjectURL(blobUrl);
            setIsDownloading(false);
          }, 'image/png');
        } else {
          setIsDownloading(false);
        }
      };

      img.src = blobUrl;
    } catch (err) {
      console.error('Download error:', err);
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-5xl h-[90vh] max-h-[820px] bg-[#1E1E1E] border border-[#3A3A3A] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#F5F5F5] select-none">
        {/* Top Header */}
        <div className="h-14 px-4 sm:px-6 border-b border-[#3A3A3A] bg-[#171717] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base">
                {conceptMap ? conceptMap.title : (t.conceptMapTitle || 'خريطة المفاهيم الذكية')}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {conceptMap && (
              <>
                {/* Download Button (Phone Photo Gallery / Image) */}
                <button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-medium text-xs shadow-md transition-colors"
                  title="تنزيل الخريطة وحفظها في صور الجهاز"
                >
                  {isDownloading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>{t.downloadImage || 'تنزيل الخريطة (صورة)'}</span>
                </button>

                {/* Regenerate / Reset */}
                <button
                  onClick={() => setConceptMap(null)}
                  className="p-1.5 text-[#B5B5B5] hover:text-white rounded-lg hover:bg-[#2B2B2B] transition-colors"
                  title="إنشاء خريطة جديدة"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Close Modal */}
            <button
              onClick={() => setConceptMapOpen(false)}
              className="p-1.5 text-[#888888] hover:text-white rounded-lg hover:bg-[#2B2B2B] transition-colors"
              title={t.close || 'إغلاق'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#171717] overflow-y-auto">
          {!conceptMap ? (
            /* Creation & Upload Form */
            <div className="max-w-2xl mx-auto w-full p-6 sm:p-10 my-auto">
              <div className="text-center mb-6">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3 shadow">
                  <Network className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-bold text-white">إنشاء خريطة مفاهيم ذكية</h2>
                <p className="text-xs text-[#999999] mt-1.5 max-w-md mx-auto leading-relaxed">
                  ارفع صور الدروس أو صفحات الكتب أو الملفات، أو اكتب موضوع الدرس لإنشاء خريطة ترابطية سريعة ودقيقة يمكنك تنزيلها وحفظها في صور هاتفك.
                </p>
              </div>

              {errorMessage && (
                <div className="mb-4 p-3 rounded-xl bg-red-950/40 border border-red-800/60 text-red-200 text-xs">
                  {errorMessage}
                </div>
              )}

              <div className="space-y-4">
                {/* Topic Input */}
                <div>
                  <label className="block text-xs font-semibold text-[#D5D5D5] mb-1.5">
                    موضوع الدرس أو عنوان الخريطة (اختياري عند إرفاق صور)
                  </label>
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="مثال: الجدول الدوري للعناصر، قوانين كبلر، علم الوراثة، أزمنة الإنجليزية..."
                    className="w-full bg-[#202020] text-sm text-white px-3.5 py-2.5 rounded-xl border border-[#3A3A3A] focus:outline-none focus:border-emerald-500 placeholder-[#666666]"
                    dir="auto"
                  />
                </div>

                {/* Upload Zone */}
                <div>
                  <label className="block text-xs font-semibold text-[#D5D5D5] mb-1.5">
                    إرفاق صور أو ملفات للشرح منها (صور صفحات الكتاب، ملازم، PDF)
                  </label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-[#3A3A3A] hover:border-emerald-500/60 rounded-xl p-5 text-center cursor-pointer bg-[#202020]/60 hover:bg-[#202020] transition-all"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.doc,.docx,.txt"
                      onChange={(e) => handleFilesAdded(e.target.files)}
                      className="hidden"
                    />
                    <Upload className="w-7 h-7 text-emerald-400 mx-auto mb-2" />
                    <p className="text-xs font-medium text-white">اضغط لاختيار صور من هاتفك أو اسحب الملفات هنا</p>
                    <p className="text-[11px] text-[#777777] mt-1">يدعم الصور (JPG, PNG) وملفات PDF والكتب الدراسية</p>
                  </div>
                </div>

                {/* Selected Files Preview List */}
                {selectedFiles.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {selectedFiles.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-2 rounded-lg bg-[#252525] border border-[#3A3A3A] text-xs"
                      >
                        <div className="flex items-center gap-2 truncate">
                          {f.type.startsWith('image/') ? (
                            <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                          )}
                          <span className="truncate text-white text-[12px]">{f.name}</span>
                          <span className="text-[10px] text-[#777777]">
                            ({(f.size / 1024).toFixed(0)} KB)
                          </span>
                        </div>
                        <button
                          onClick={() => removeSelectedFile(i)}
                          className="text-[#888888] hover:text-red-400 p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold text-sm shadow-lg flex items-center justify-center gap-2 transition-all mt-4"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>جاري استخراج وتحليل المفاهيم ورسم الخريطة...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>توليد خريطة المفاهيم الآن</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Visual Concept Map Renderer */
            <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-auto">
              {/* Concept Map SVG Visual Canvas */}
              <div className="flex-1 min-h-[520px] bg-[#1A1A1A] border border-[#333333] rounded-2xl p-4 sm:p-6 overflow-auto flex items-center justify-center shadow-inner relative">
                <svg
                  ref={mapSvgRef}
                  viewBox="0 0 1100 780"
                  className="w-full max-w-[1100px] h-auto min-h-[600px] text-white"
                  style={{ fontFamily: 'inherit' }}
                >
                  <defs>
                    <linearGradient id="centralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#1E3A8A" />
                      <stop offset="100%" stopColor="#1E40AF" />
                    </linearGradient>
                    <filter id="shadowFilter" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.3" floodColor="#000000" />
                    </filter>
                  </defs>

                  {/* Connecting branches and lines */}
                  {conceptMap.branches.map((branch, bIdx) => {
                    const branchCount = conceptMap.branches.length;
                    const angle = ((bIdx + 0.5) / branchCount) * (2 * Math.PI) - Math.PI / 2;
                    const distance = 270;
                    const bx = 550 + Math.cos(angle) * distance;
                    const by = 390 + Math.sin(angle) * distance;

                    return (
                      <g key={`branch-line-${branch.id || bIdx}`}>
                        {/* Curved Path from Central node to Branch Header */}
                        <path
                          d={`M 550 390 Q ${(550 + bx) / 2} ${(390 + by) / 2 - 20} ${bx} ${by}`}
                          fill="none"
                          stroke={branch.color || '#3B82F6'}
                          strokeWidth="3.5"
                          strokeDasharray="4,2"
                          opacity="0.85"
                        />

                        {/* Subnodes connected to Branch */}
                        {branch.nodes.map((node, nIdx) => {
                          const subAngle = angle + ((nIdx - (branch.nodes.length - 1) / 2) * 0.35);
                          const subDist = 110;
                          const nx = bx + Math.cos(subAngle) * subDist;
                          const ny = by + Math.sin(subAngle) * subDist;

                          return (
                            <g key={`node-line-${node.id || nIdx}`}>
                              <line
                                x1={bx}
                                y1={by}
                                x2={nx}
                                y2={ny}
                                stroke={branch.color || '#3B82F6'}
                                strokeWidth="2"
                                opacity="0.6"
                              />

                              {/* Child Concept Card */}
                              <rect
                                x={nx - 85}
                                y={ny - 30}
                                width="170"
                                height="60"
                                rx="10"
                                fill="#262626"
                                stroke={branch.color || '#3B82F6'}
                                strokeWidth="1.5"
                                filter="url(#shadowFilter)"
                              />
                              <text
                                x={nx}
                                y={ny - 10}
                                fill="#FFFFFF"
                                fontSize="12"
                                fontWeight="bold"
                                textAnchor="middle"
                              >
                                {node.label.length > 20 ? node.label.slice(0, 19) + '…' : node.label}
                              </text>
                              {node.details && (
                                <text
                                  x={nx}
                                  y={ny + 8}
                                  fill="#A3A3A3"
                                  fontSize="9.5"
                                  textAnchor="middle"
                                >
                                  {node.details.length > 25 ? node.details.slice(0, 24) + '…' : node.details}
                                </text>
                              )}
                              {node.subNodes && node.subNodes.length > 0 && (
                                <text
                                  x={nx}
                                  y={ny + 22}
                                  fill={branch.color || '#3B82F6'}
                                  fontSize="8.5"
                                  textAnchor="middle"
                                  fontWeight="600"
                                >
                                  • {node.subNodes[0].slice(0, 24)}
                                </text>
                              )}
                            </g>
                          );
                        })}

                        {/* Branch Node Header Card */}
                        <rect
                          x={bx - 90}
                          y={by - 25}
                          width="180"
                          height="50"
                          rx="12"
                          fill="#1E1E1E"
                          stroke={branch.color || '#3B82F6'}
                          strokeWidth="2.5"
                          filter="url(#shadowFilter)"
                        />
                        <circle cx={bx - 70} cy={by} r="7" fill={branch.color || '#3B82F6'} />
                        <text
                          x={bx + 5}
                          y={by + 5}
                          fill="#FFFFFF"
                          fontSize="13"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {branch.title.length > 18 ? branch.title.slice(0, 17) + '…' : branch.title}
                        </text>
                      </g>
                    );
                  })}

                  {/* Central Concept Node */}
                  <g filter="url(#shadowFilter)">
                    <rect
                      x="420"
                      y="335"
                      width="260"
                      height="110"
                      rx="20"
                      fill="url(#centralGrad)"
                      stroke="#60A5FA"
                      strokeWidth="3"
                    />
                    <text
                      x="550"
                      y="375"
                      fill="#93C5FD"
                      fontSize="12"
                      fontWeight="600"
                      textAnchor="middle"
                      letterSpacing="1"
                    >
                      المفهوم الأساسي المركزي
                    </text>
                    <text
                      x="550"
                      y="405"
                      fill="#FFFFFF"
                      fontSize="17"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {conceptMap.centralConcept.length > 22
                        ? conceptMap.centralConcept.slice(0, 21) + '…'
                        : conceptMap.centralConcept}
                    </text>
                    <text
                      x="550"
                      y="428"
                      fill="#E0E7FF"
                      fontSize="10.5"
                      textAnchor="middle"
                    >
                      Stu.Ai • خريطة مفاهيم علمية
                    </text>
                  </g>
                </svg>
              </div>

              {/* Summary and Relations Tray */}
              <div className="mt-4 p-4 rounded-xl bg-[#202020] border border-[#333333]">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-bold text-white">ملخص وترابط المفاهيم</h4>
                </div>
                <p className="text-xs text-[#CCCCCC] leading-relaxed">
                  {conceptMap.summary}
                </p>

                {conceptMap.relationships && conceptMap.relationships.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#333333] flex flex-wrap gap-2">
                    {conceptMap.relationships.map((rel, rIdx) => (
                      <span
                        key={rIdx}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#2A2A2A] border border-[#3A3A3A] text-[11px] text-[#E5E5E5]"
                      >
                        <span className="font-semibold text-white">{rel.from}</span>
                        <span className="text-emerald-400">({rel.label})</span>
                        <ArrowRight className="w-3 h-3 text-[#777777]" />
                        <span className="font-semibold text-white">{rel.to}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
