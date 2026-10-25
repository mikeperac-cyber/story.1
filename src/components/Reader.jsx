import React, { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

function Brand() {
  return (
    <span className="brand-lockup reader-brand-lockup">
      <img src="/images/brand/lanternberry-mark.png" alt="" className="brand-mark" />
      <span>The Lanternberry Path</span>
    </span>
  );
}

export default function Reader({
  story,
  page,
  pageNumber,
  pageBookmarked,
  speechState,
  audioMessage,
  voices,
  voiceURI,
  speechRate,
  textScale,
  panelOpacity,
  isFullscreen,
  onBack,
  onChangePage,
  onToggleBookmark,
  onStartListening,
  onTogglePause,
  onVoiceChange,
  onSpeechRateChange,
  onTextScaleChange,
  onPanelOpacityChange,
  onToggleFullscreen,
}) {
  const touchStartX = useRef(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 700);

  useEffect(() => {
    function updateViewport() {
      setIsMobile(window.innerWidth <= 700);
    }
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const fontSize = Math.round((isMobile ? 16 : 19) * textScale);

  function onTouchStart(event) {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  }

  function onTouchEnd(event) {
    if (touchStartX.current === null) return;
    const distance = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 48) return;
    onChangePage(pageNumber + (distance < 0 ? 1 : -1));
  }

  return (
    <div className="reader-screen">
      <header className="reader-header">
        <a
          className="brand-link"
          href="./"
          onClick={(event) => {
            event.preventDefault();
            onBack();
          }}
          aria-label="The Lanternberry Path home"
        >
          <Brand />
        </a>
        <button className="all-stories-link" type="button" onClick={onBack}>
          <Icon name="arrowLeft" size={20} /> <span>All stories</span>
        </button>
      </header>

      <main className="reader-main">
        <div className="reader-context">
          <h1>{story.title}</h1>
          <button
            className="fullscreen-button"
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
            title={isFullscreen ? "Exit full screen" : "Full screen"}
          >
            <Icon name="fullscreen" size={19} />
            <span>{isFullscreen ? "Exit full screen" : "Full screen"}</span>
          </button>
        </div>

        <figure
          className="reader-page"
          style={{ "--panel-opacity": panelOpacity, "--story-font-size": `${fontSize}px` }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          aria-label={`${story.title}, page ${pageNumber} of 10`}
        >
          <img className="reader-page-art" src={page.artUrl} alt={page.alt} fetchPriority="high" />
          <figcaption className="story-text-panel">
            <p>{page.text}</p>
          </figcaption>
        </figure>

        <nav className="page-progress" aria-label="Pages in this story">
          <div className="page-dots">
            {story.pages.map((item) => (
              <button
                type="button"
                key={item.number}
                className={`page-dot ${item.number === pageNumber ? "is-active" : ""} ${item.number < pageNumber ? "is-read" : ""}`}
                aria-label={`Go to page ${item.number}`}
                aria-current={item.number === pageNumber ? "page" : undefined}
                onClick={() => onChangePage(item.number)}
              />
            ))}
          </div>
          <span className="page-count">{pageNumber} of 10</span>
        </nav>

        <div className="reader-toolbar" aria-label="Reader controls">
          <button
            type="button"
            className="page-nav-button previous-button"
            onClick={() => onChangePage(pageNumber - 1)}
            disabled={story.id === 1 && pageNumber === 1}
          >
            <Icon name="arrowLeft" size={22} /> <span>Previous page</span>
          </button>

          <div className="toolbar-group audio-controls" aria-label="Read aloud controls">
            <button className={`icon-text-control ${speechState === "speaking" ? "is-active" : ""}`} type="button" onClick={onStartListening}>
              <span className="round-control"><Icon name="volume" size={23} /></span>
              <span>Listen</span>
            </button>
            <button
              className={`icon-text-control ${speechState === "paused" ? "is-active" : ""}`}
              type="button"
              onClick={onTogglePause}
              disabled={speechState === "idle"}
            >
              <span className="round-control"><Icon name={speechState === "paused" ? "play" : "pause"} size={21} /></span>
              <span>{speechState === "paused" ? "Resume" : "Pause"}</span>
            </button>
          </div>

          <div className="toolbar-group narration-controls" aria-label="Narration settings">
              <label className="narration-field" htmlFor="narration-voice">
                <span className="control-label">Voice</span>
                <select
                  id="narration-voice"
                  value={voiceURI}
                  onChange={(event) => onVoiceChange(event.target.value)}
                  title="Kokoro is the consistent offline voice. Device voices add gentle sentence-by-sentence expression; available voices vary by browser."
                >
                  <option value="kokoro">Kokoro · Offline storyteller</option>
                  <option value="device">Expressive device storyteller</option>
                  {voices.map((voice) => (
                    <option key={`${voice.voiceURI}-${voice.lang}`} value={voice.voiceURI}>
                      {voice.name} · {voice.lang}{voice.localService ? " · on device" : " · online"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="narration-field narration-rate-field" htmlFor="narration-rate">
                <span className="narration-rate-heading">
                  <span className="control-label">Reading pace</span>
                  <span className="narration-rate-actions">
                    <button
                      className="pace-preset-button"
                      type="button"
                      aria-label="Set a slow reading pace of 0.6 times"
                      aria-pressed={speechRate <= 0.62}
                      onClick={() => onSpeechRateChange(0.6)}
                    >Slow</button>
                    <output htmlFor="narration-rate">{speechRate.toFixed(2)}×</output>
                  </span>
                </span>
                <input
                  id="narration-rate"
                  type="range"
                  min="0.5"
                  max="1.15"
                  step="0.01"
                  value={speechRate}
                  aria-label="Reading pace"
                  onChange={(event) => onSpeechRateChange(Number(event.target.value))}
                  style={{ "--range-progress": `${((speechRate - 0.5) / 0.65) * 100}%` }}
                />
              </label>
          </div>

          <div className="toolbar-group text-size-controls" aria-label="Text size">
            <span className="control-label">Text size</span>
            <div className="size-buttons">
              <button
                type="button"
                className="size-button size-small"
                aria-label="Decrease text size"
                onClick={() => onTextScaleChange(Math.max(0.9, Number((textScale - 0.1).toFixed(2))))}
                disabled={textScale <= 0.9}
              >A−</button>
              <button
                type="button"
                className="size-button size-large"
                aria-label="Increase text size"
                onClick={() => onTextScaleChange(Math.min(1.25, Number((textScale + 0.1).toFixed(2))))}
                disabled={textScale >= 1.25}
              >A+</button>
            </div>
          </div>

          <div className="toolbar-group panel-opacity-control">
            <label className="control-label" htmlFor="panel-opacity">Page background</label>
            <div className="opacity-input-row">
              <input
                id="panel-opacity"
                type="range"
                min="0.72"
                max="0.96"
                step="0.02"
                value={panelOpacity}
                aria-label="Page background opacity"
                onChange={(event) => onPanelOpacityChange(Number(event.target.value))}
                style={{ "--range-progress": `${((panelOpacity - 0.72) / 0.24) * 100}%` }}
              />
              <output htmlFor="panel-opacity">{Math.round(panelOpacity * 100)}%</output>
            </div>
          </div>

          <button
            className={`bookmark-page-button ${pageBookmarked ? "is-bookmarked" : ""}`}
            type="button"
            aria-pressed={pageBookmarked}
            onClick={onToggleBookmark}
          >
            <span className="bookmark-control-icon"><Icon name="bookmark" size={23} filled={pageBookmarked} /></span>
            <span>{pageBookmarked ? "Bookmarked" : "Bookmark page"}</span>
          </button>

          <button
            type="button"
            className="page-nav-button next-button"
            onClick={() => onChangePage(pageNumber + 1)}
            disabled={story.id === 10 && pageNumber === 10}
          >
            <span>Next page</span> <Icon name="arrowRight" size={22} />
          </button>
        </div>
        <p className="reader-live-message" aria-live="polite">{audioMessage}</p>
        <p className="keyboard-hint">Use ← and → to turn pages, or swipe on a touch screen.</p>
      </main>
    </div>
  );
}
