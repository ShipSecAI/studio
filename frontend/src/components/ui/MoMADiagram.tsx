import React, { useState, useRef, useEffect, useCallback } from 'react';
import mermaid from 'mermaid';
import { Copy, Download, Maximize2, ZoomIn, ZoomOut, RotateCcw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Initialize Mermaid once
let mermaidInitialized = false;

const initializeMermaid = () => {
  if (mermaidInitialized) return;

  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      primaryColor: '#3C82F6',
      primaryTextColor: '#FFFFFF',
      primaryBorderColor: '#2563EB',
      lineColor: '#7A7C80',
      secondaryColor: '#F3F4F6',
      tertiaryColor: '#E5E7EB',
      background: '#1C1C1C',
      mainBkg: '#232427',
      nodeBorder: '#2A2B2D',
      clusterBkg: '#232427',
      clusterBorder: '#2A2B2D',
      titleColor: '#FFFFFF',
      edgeLabelBackground: '#1F2023',
      actorBkg: '#232427',
      actorBorder: '#2A2B2D',
      actorLineColor: '#7A7C80',
      signalColor: '#7A7C80',
      signalTextColor: '#C6C7C8',
      labelBoxBkgColor: '#1F2023',
      labelBoxBorderColor: '#2A2B2D',
      labelTextColor: '#C6C7C8',
      loopTextColor: '#C6C7C8',
      noteBorderColor: '#2A2B2D',
      noteTextColor: '#C6C7C8',
      message0: '#3C82F6',
      message1: '#10B981',
      message2: '#F59E0B',
      message3: '#EF4444',
      message4: '#8B5CF6',
      message5: '#EC4899',
      message6: '#14B8A6',
      message7: '#F97316',
    },
    securityLevel: 'loose',
    fontFamily: 'DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    fontSize: 14,
    flowchart: {
      curve: 'basis',
      padding: 20,
      nodeSpacing: 50,
      rankSpacing: 50,
      useMaxWidth: true,
    },
    sequence: {
      diagramMarginX: 50,
      diagramMarginY: 10,
      actorMargin: 50,
      width: 150,
      height: 65,
      boxMargin: 10,
      boxTextMargin: 5,
      noteMargin: 10,
      messageMargin: 35,
      useMaxWidth: true,
    },
  });
  mermaidInitialized = true;
};

export interface MoMADiagramProps {
  code: string;
  className?: string;
  onEdit?: (code: string) => void;
}

type ViewState = 'idle' | 'loading' | 'rendered' | 'error';

interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

export const MoMADiagram = React.forwardRef<HTMLDivElement, MoMADiagramProps>(
  ({ code, className, onEdit }, ref) => {
    const [viewState, setViewState] = useState<ViewState>('idle');
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [svgContent, setSvgContent] = useState<string>('');
    const [transform, setTransform] = useState<Transform>({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [showCopyFeedback, setShowCopyFeedback] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<HTMLDivElement>(null);
    const diagramIdRef = useRef<string>(`mermaid-${Math.random().toString(36).substr(2, 9)}`);

    // Initialize Mermaid on mount
    useEffect(() => {
      initializeMermaid();
    }, []);

    // Parse and render diagram when code changes
    useEffect(() => {
      if (!code.trim()) {
        setViewState('idle');
        return;
      }

      const renderDiagram = async () => {
        setViewState('loading');
        setErrorMessage('');

        try {
          // Ensure Mermaid is initialized
          initializeMermaid();

          const uniqueId = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
          diagramIdRef.current = uniqueId;

          // Parse and render the diagram
          const { svg } = await mermaid.render(uniqueId, code);
          setSvgContent(svg);
          setViewState('rendered');

          // Reset transform when new diagram renders
          setTransform({ scale: 1, translateX: 0, translateY: 0 });
        } catch (error) {
          console.error('Mermaid rendering error:', error);
          setErrorMessage(error instanceof Error ? error.message : 'Failed to render diagram');
          setViewState('error');
        }
      };

      const debounceTimer = setTimeout(renderDiagram, 150);
      return () => clearTimeout(debounceTimer);
    }, [code]);

    // Handle wheel zoom
    const handleWheel = useCallback(
      (e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newScale = Math.min(Math.max(transform.scale + delta, 0.1), 5);
        setTransform((prev) => ({ ...prev, scale: newScale }));
      },
      [transform.scale],
    );

    // Handle pan drag start
    const handleMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return; // Only left mouse button
        setIsDragging(true);
        setDragStart({ x: e.clientX - transform.translateX, y: e.clientY - transform.translateY });
      },
      [transform],
    );

    // Handle pan drag move
    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        e.preventDefault();
        setTransform({
          ...transform,
          translateX: e.clientX - dragStart.x,
          translateY: e.clientY - dragStart.y,
        });
      },
      [isDragging, dragStart, transform],
    );

    // Handle pan drag end
    const handleMouseUp = useCallback(() => {
      setIsDragging(false);
    }, []);

    // Handle global mouse up to catch drag releases outside container
    useEffect(() => {
      const handleGlobalMouseUp = () => setIsDragging(false);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    // Zoom controls
    const handleZoomIn = useCallback(() => {
      setTransform((prev) => ({ ...prev, scale: Math.min(prev.scale + 0.2, 5) }));
    }, []);

    const handleZoomOut = useCallback(() => {
      setTransform((prev) => ({ ...prev, scale: Math.max(prev.scale - 0.2, 0.1) }));
    }, []);

    const handleResetView = useCallback(() => {
      setTransform({ scale: 1, translateX: 0, translateY: 0 });
    }, []);

    const handleFitToScreen = useCallback(() => {
      if (!containerRef.current || !svgRef.current) return;

      const container = containerRef.current;
      const svg = svgRef.current.firstElementChild;

      if (!svg) return;

      const containerRect = container.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();

      const padding = 40;
      const scaleX = (containerRect.width - padding) / svgRect.width;
      const scaleY = (containerRect.height - padding) / svgRect.height;
      const newScale = Math.min(scaleX, scaleY, 1);

      setTransform({ scale: newScale, translateX: 0, translateY: 0 });
    }, []);

    // Copy code to clipboard
    const handleCopyCode = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(code);
        setShowCopyFeedback(true);
        setTimeout(() => setShowCopyFeedback(false), 2000);
      } catch (error) {
        console.error('Failed to copy code:', error);
      }
    }, [code]);

    // Download SVG
    const handleDownloadSVG = useCallback(() => {
      if (!svgContent) return;

      const blob = new Blob([svgContent], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `diagram-${Date.now()}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, [svgContent]);

    return (
      <div
        ref={(node) => {
          // Handle both refs
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
          containerRef.current = node;
        }}
        className={cn(
          'relative overflow-hidden rounded-lg border bg-card',
          'shadow-sm transition-shadow duration-200',
          'hover:shadow-md',
          className,
        )}
        style={{ height: '100%', minHeight: '300px' }}
      >
        {/* Toolbar */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-3 py-2 bg-card/80 backdrop-blur-sm border-b">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-muted-foreground mr-2">Diagram</span>
          </div>
          <div className="flex items-center gap-1">
            {/* Zoom controls */}
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetView}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Reset view"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={handleFitToScreen}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Fit to screen"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-border mx-1" />

            {/* Action buttons */}
            <button
              onClick={handleCopyCode}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors relative"
              title="Copy code"
            >
              {showCopyFeedback ? (
                <span className="text-xs font-medium text-green-500">Copied!</span>
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={handleDownloadSVG}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Download SVG"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Diagram container */}
        <div
          className="absolute inset-0 top-10 cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <div
            className="w-full h-full flex items-center justify-center"
            style={{
              transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {viewState === 'loading' && (
              <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="text-sm">Rendering diagram...</span>
              </div>
            )}

            {viewState === 'error' && (
              <div className="flex flex-col items-center justify-center gap-3 p-6 max-w-md text-center">
                <div className="p-3 rounded-full bg-destructive/10">
                  <svg
                    className="w-6 h-6 text-destructive"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium text-foreground mb-1">Diagram Error</h3>
                  <p className="text-sm text-muted-foreground">
                    {errorMessage || 'Unable to render the diagram. Please check the syntax.'}
                  </p>
                </div>
                {onEdit && (
                  <button
                    onClick={() => onEdit(code)}
                    className="mt-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Edit Diagram Code
                  </button>
                )}
              </div>
            )}

            {viewState === 'rendered' && svgContent && (
              <div
                ref={svgRef}
                dangerouslySetInnerHTML={{ __html: svgContent }}
                className="mermaid-diagram"
                style={{ maxWidth: '100%', maxHeight: '100%' }}
              />
            )}

            {viewState === 'idle' && (
              <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <svg
                  className="w-12 h-12 opacity-50"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
                  />
                </svg>
                <span className="text-sm">No diagram to display</span>
              </div>
            )}
          </div>
        </div>

        {/* Zoom indicator */}
        {transform.scale !== 1 && (
          <div className="absolute bottom-3 left-3 px-2 py-1 rounded-md bg-card/80 backdrop-blur-sm border text-xs font-medium text-muted-foreground">
            {Math.round(transform.scale * 100)}%
          </div>
        )}
      </div>
    );
  },
);

MoMADiagram.displayName = 'MoMADiagram';

export default MoMADiagram;

/**
 * Utility function to extract Mermaid/MoMA diagram code from markdown text.
 * Supports both ```mermaid and ```moma code blocks.
 */
export function extractDiagramCode(text: string): string | null {
  // Try to match ```moma or ```mermaid code blocks
  const mermaidRegex = /```(?:moma|mermaid)\n([\s\S]*?)```/i;
  const match = text.match(mermaidRegex);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Utility function to extract all Mermaid/MoMA diagrams from markdown text.
 * Returns an array of diagram code strings.
 */
export function extractAllDiagrams(text: string): string[] {
  const mermaidRegex = /```(?:moma|mermaid)\n([\s\S]*?)```/gi;
  const matches: string[] = [];
  let match;

  while ((match = mermaidRegex.exec(text)) !== null) {
    if (match[1]) {
      matches.push(match[1].trim());
    }
  }

  return matches;
}
