/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { jsPDF } from 'jspdf';

type VisualIdeas = {
    shotSuggestions: string[];
    bRoll: string[];
};
type GeneratedSectionValue = string | VisualIdeas;

const App = () => {
    const [scriptContent, setScriptContent] = useState('');
    const [wordCount, setWordCount] = useState('');
    const [advancedInstructions, setAdvancedInstructions] = useState('');
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['Instagram']);
    const [generatedSections, setGeneratedSections] = useState<Record<string, GeneratedSectionValue> | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    
    // TTS State
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | undefined>();
    const [speakingKey, setSpeakingKey] = useState<string | null>(null);
    const [isShareSupported, setIsShareSupported] = useState(false);

    const platforms = ['Instagram', 'YouTube', 'Facebook', 'TikTok', 'LinkedIn', 'Website'];

    useEffect(() => {
        if (navigator.share) {
            setIsShareSupported(true);
        }
    }, []);

    // Load TTS voices
    useEffect(() => {
        const loadVoices = () => {
            const availableVoices = window.speechSynthesis.getVoices();
            if (availableVoices.length > 0) {
                setVoices(availableVoices);
                if (!selectedVoiceURI) {
                    // Try to find a default US English voice
                    const defaultVoice = availableVoices.find(v => v.lang === 'en-US');
                    setSelectedVoiceURI(defaultVoice ? defaultVoice.voiceURI : availableVoices[0].voiceURI);
                }
            }
        };
        // onvoiceschanged is not always reliable, so we poll
        loadVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
             window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }, [selectedVoiceURI]);

    const handlePlatformToggle = (platform: string) => {
        setSelectedPlatforms(prev =>
            prev.includes(platform)
                ? prev.filter(p => p !== platform)
                : [...prev, platform]
        );
    };

    const handleGenerate = async () => {
        if (!scriptContent.trim()) {
            setError("Please enter a content idea first.");
            return;
        }
        if (selectedPlatforms.length === 0) {
            setError("Please select at least one target platform.");
            return;
        }
        setIsLoading(true);
        setError(null);
        setGeneratedSections(null);

        let prompt = `Based on the following content idea, generate a script for a social media post tailored for the following platforms: ${selectedPlatforms.join(', ')}. Include a hook, introduction, main content, a call to action, detailed visual ideas (with specific shot suggestions and B-roll ideas), and relevant hashtags.\n\nIdea: "${scriptContent}"`;

        if (wordCount && parseInt(wordCount) > 0) {
            prompt += `\n\nThe main content should be approximately ${wordCount} words.`;
        }

        if (advancedInstructions.trim()) {
            prompt += `\n\nAdvanced Instructions: ${advancedInstructions.trim()}`;
        }
        
        const systemInstruction = `You are a helpful social media script generator. Your primary goal is to create engaging and appropriate content. You must adhere to the following safety policies strictly:
1.  **Adult Content:** If the user's content idea or instructions request sexually explicit, violent, or otherwise inappropriate adult content, you MUST refuse the request. To do this, return a valid JSON object where the 'hook' field contains ONLY the exact string 'CONTENT_VIOLATION' and all other fields are empty. Do not explain why.
2.  **Visuals Policy:** In the 'visualIdeas' section, you must not suggest or describe any visuals that include images of women. You can describe scenes, objects, text, or men, but explicitly avoid mentioning women in both 'shotSuggestions' and 'bRoll'.`;

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction: systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            hook: { type: Type.STRING, description: "A short, attention-grabbing sentence." },
                            introduction: { type: Type.STRING, description: "A brief introduction to the topic." },
                            mainContent: { type: Type.STRING, description: "The main body of the script." },
                            callToAction: { type: Type.STRING, description: "What you want the viewer to do next." },
                            visualIdeas: {
                                type: Type.OBJECT,
                                description: "Detailed and actionable visual suggestions.",
                                properties: {
                                    shotSuggestions: {
                                        type: Type.ARRAY,
                                        items: { type: Type.STRING },
                                        description: "Specific camera shot ideas (e.g., 'Close-up on the product')."
                                    },
                                    bRoll: {
                                        type: Type.ARRAY,
                                        items: { type: Type.STRING },
                                        description: "Ideas for supplemental or cutaway footage (e.g., 'Time-lapse of clouds')."
                                    }
                                },
                                required: ['shotSuggestions', 'bRoll']
                            },
                            hashtags: { type: Type.STRING, description: "Relevant hashtags, separated by spaces." },
                        },
                        required: ['hook', 'introduction', 'mainContent', 'callToAction', 'visualIdeas', 'hashtags']
                    }
                }
            });

            if (!response?.text) {
                console.error("API Error: Response was empty.", response);
                setError("The model did not return a script. This might be due to a content safety filter. Please try modifying your request.");
                return;
            }

            try {
                const jsonResponse = JSON.parse(response.text);
                if (jsonResponse.hook === 'CONTENT_VIOLATION') {
                    setError("Sorry, we are not able to provide this type of information.");
                    setGeneratedSections(null);
                    return;
                }
                setGeneratedSections(jsonResponse);
            } catch (parseError) {
                console.error("JSON Parsing Error:", parseError, "Raw Text:", response.text);
                setError("The generated script was not in the expected format. Please try again.");
            }
        } catch (e) {
            console.error("API Error:", e);
            setError(e instanceof Error ? e.message : "An unknown error occurred.");
        } finally {
            setIsLoading(false);
        }
    };

    const formatTitle = (title: string) => {
        return title.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
    };

    const handleCopy = (key: string, textToCopy: string) => {
        navigator.clipboard.writeText(textToCopy);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
    };

    const getFullScriptText = (forCopy: boolean = false): string => {
        if (!generatedSections) return '';
        return Object.entries(generatedSections)
            .map(([key, value]) => {
                const title = formatTitle(key);
                if (typeof value === 'string') {
                    return `${title}\n${value}`;
                } else if (value && typeof value === 'object') {
                    const visualIdeas = value as VisualIdeas;
                    const shots = visualIdeas.shotSuggestions.map(s => `- ${s}`).join('\n');
                    const bRolls = visualIdeas.bRoll.map(b => `- ${b}`).join('\n');
                    return `${title}\nShot Suggestions:\n${shots}\n\nB-Roll:\n${bRolls}`;
                }
                return '';
            })
            .join('\n\n');
    };

    const handleExportPdf = () => {
        if (!generatedSections) return;
        const doc = new jsPDF();
        const fullText = getFullScriptText(false);
        
        const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
        const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
        const margin = 15;
        let y = 15;

        doc.setFontSize(11);
        const textLines = doc.splitTextToSize(fullText, pageWidth - margin * 2);

        textLines.forEach((line: string) => {
            if (y > pageHeight - margin) {
                doc.addPage();
                y = margin;
            }
            doc.text(line, margin, y);
            y += 7; 
        });

        doc.save('script.pdf');
    };

    const handleExportDocx = async () => {
        if (!generatedSections) return;

        const paragraphs: Paragraph[] = [];
        Object.entries(generatedSections).forEach(([key, value]) => {
            paragraphs.push(new Paragraph({
                children: [new TextRun({ text: formatTitle(key), bold: true, size: 28 })],
                heading: HeadingLevel.HEADING_1,
                spacing: { after: 200 },
            }));

            if (typeof value === 'string') {
                value.split('\n').forEach(line => paragraphs.push(new Paragraph({ children: [new TextRun(line)] })));
            } else if (value && typeof value === 'object') {
                const visualIdeas = value as VisualIdeas;
                paragraphs.push(new Paragraph({ children: [new TextRun({ text: "Shot Suggestions", bold: true })] }));
                visualIdeas.shotSuggestions.forEach(s => paragraphs.push(new Paragraph({ text: s, bullet: { level: 0 } })));
                paragraphs.push(new Paragraph({ children: [new TextRun({ text: "B-Roll", bold: true })], spacing: { before: 200 } }));
                visualIdeas.bRoll.forEach(b => paragraphs.push(new Paragraph({ text: b, bullet: { level: 0 } })));
            }
            paragraphs.push(new Paragraph(""));
        });

        const doc = new Document({ sections: [{ children: paragraphs }] });
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'script.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
    
    const handleShare = async () => {
        if (!generatedSections || !isShareSupported) return;
        try {
            await navigator.share({
                title: 'AI Generated Script',
                text: getFullScriptText(true),
            });
        } catch (err) {
            console.error('Share failed:', err);
            setError("Could not share the script.");
        }
    };
    
    const handleListen = (key: string, textToSpeak: string) => {
        if (speakingKey === key) {
            window.speechSynthesis.cancel();
            setSpeakingKey(null);
            return;
        }
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        const selectedVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
        if (selectedVoice) utterance.voice = selectedVoice;

        utterance.onend = () => setSpeakingKey(null);
        utterance.onerror = () => {
            setSpeakingKey(null);
            setError("Text-to-speech failed. Your browser might not support the selected voice.");
        };
        setSpeakingKey(key);
        window.speechSynthesis.speak(utterance);
    };

    return (
        <div className="app-container">
            <header>
                <h1>AI Script Writer</h1>
                <p className="subtitle">Craft compelling scripts for any platform, instantly.</p>
            </header>
            <main className="main-content">
                <div className="input-panel">
                    <div className="input-card">
                         <div className="input-group">
                            <label htmlFor="script-input">Content Idea</label>
                            <textarea
                                id="script-input"
                                value={scriptContent}
                                onChange={(e) => setScriptContent(e.target.value)}
                                placeholder="e.g., A 30-second Instagram Reel about the benefits of drinking water."
                                rows={8}
                                aria-label="Content idea input area"
                                disabled={isLoading}
                            />
                        </div>
                        <div className="inline-inputs">
                            <div className="input-group">
                                <label htmlFor="word-count-input">Word Count</label>
                                <input
                                    id="word-count-input"
                                    type="number"
                                    value={wordCount}
                                    onChange={(e) => setWordCount(e.target.value)}
                                    placeholder="e.g., 100"
                                    aria-label="Optional word count for main content"
                                    disabled={isLoading}
                                    min="1"
                                />
                            </div>
                            <div className="input-group">
                                <label htmlFor="advanced-instructions-input">Tone/Style</label>
                                <input
                                    id="advanced-instructions-input"
                                    type="text"
                                    value={advancedInstructions}
                                    onChange={(e) => setAdvancedInstructions(e.target.value)}
                                    placeholder="e.g., Humorous, Gen Z"
                                    aria-label="Advanced instructions for script style, audience, or keywords"
                                    disabled={isLoading}
                                />
                            </div>
                        </div>
                        <div className="input-group">
                            <label>Target Platforms</label>
                            <div className="platform-group">
                                {platforms.map(platform => (
                                    <button
                                        key={platform}
                                        className={`platform-btn ${selectedPlatforms.includes(platform) ? 'selected' : ''}`}
                                        onClick={() => handlePlatformToggle(platform)}
                                        disabled={isLoading}
                                        aria-pressed={selectedPlatforms.includes(platform)}
                                    >
                                        {platform}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <button className="generate-btn" onClick={handleGenerate} disabled={isLoading}>
                            {isLoading ? 'Generating...' : 'Generate Script'}
                        </button>
                    </div>
                </div>

                {(isLoading || generatedSections || error) && (
                    <div className="results-panel">
                        {isLoading && <div className="loader" aria-label="Loading content"></div>}
                        {error && !isLoading && <p className="error">{error}</p>}
                        {generatedSections && (
                            <div className="sections-container">
                                <div className="sections-header">
                                    <h2>Generated Script</h2>
                                    <div className="header-actions">
                                        {voices.length > 0 && (
                                            <select value={selectedVoiceURI} onChange={e => setSelectedVoiceURI(e.target.value)} className="voice-select" aria-label="Select voice for text-to-speech">
                                                {voices.map(voice => (
                                                    <option key={voice.voiceURI} value={voice.voiceURI}>{`${voice.name} (${voice.lang})`}</option>
                                                ))}
                                            </select>
                                        )}
                                        <button onClick={handleExportPdf} className="export-btn" title="Export as PDF">PDF</button>
                                        <button onClick={handleExportDocx} className="export-btn" title="Export as DOCX">DOCX</button>
                                        {isShareSupported && <button onClick={handleShare} className="export-btn share-btn" title="Share Script">Share</button>}
                                    </div>
                                </div>
                                {Object.entries(generatedSections).map(([key, value]) => (
                                    <div key={key} className="section-card">
                                        <div className="section-card-header">
                                            <h3>{formatTitle(key)}</h3>
                                            <div className="section-card-actions">
                                                <button className="icon-btn" onClick={() => handleListen(key, typeof value === 'string' ? value : `Shot Suggestions: ${value.shotSuggestions.join('. ')}. B-Roll: ${value.bRoll.join('. ')}`)} aria-label={`Listen to ${formatTitle(key)}`} title={speakingKey === key ? "Stop" : "Listen"}>
                                                    {speakingKey === key ? '❚❚' : '▶'}
                                                </button>
                                                <button className="copy-btn" onClick={() => handleCopy(key, typeof value === 'string' ? value : `Shot Suggestions:\n${(value as VisualIdeas).shotSuggestions.join('\n')}\n\nB-Roll:\n${(value as VisualIdeas).bRoll.join('\n')}`)}>
                                                    {copiedKey === key ? 'Copied!' : 'Copy'}
                                                </button>
                                            </div>
                                        </div>
                                        {typeof value === 'string' ? (
                                            <p>{value}</p>
                                        ) : (
                                            <div className="visual-ideas">
                                                <h4>Shot Suggestions</h4>
                                                <ul>
                                                    {(value as VisualIdeas).shotSuggestions.map((shot, i) => <li key={i}>{shot}</li>)}
                                                </ul>
                                                <h4>B-Roll</h4>
                                                <ul>
                                                    {(value as VisualIdeas).bRoll.map((roll, i) => <li key={i}>{roll}</li>)}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);