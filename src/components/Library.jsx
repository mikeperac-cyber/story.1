import React, { useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";

function Brand() {
  return (
    <span className="brand-lockup">
      <img src="/images/brand/lanternberry-mark.png" alt="" className="brand-mark" />
      <span>The Lanternberry Path</span>
    </span>
  );
}

function Header({ view, onShowStories, onShowBookmarks }) {
  return (
    <header className="site-header">
      <a
        className="brand-link"
        href="./"
        onClick={(event) => {
          event.preventDefault();
          onShowStories();
        }}
        aria-label="The Lanternberry Path home"
      >
        <Brand />
      </a>
      <nav className="site-nav" aria-label="Main navigation">
        <button
          className={`nav-link ${view === "library" ? "is-current" : ""}`}
          type="button"
          aria-current={view === "library" ? "page" : undefined}
          onClick={onShowStories}
        >
          Stories
        </button>
        <button
          className={`nav-link ${view === "bookmarks" ? "is-current" : ""}`}
          type="button"
          aria-current={view === "bookmarks" ? "page" : undefined}
          onClick={onShowBookmarks}
        >
          Bookmarks
        </button>
      </nav>
    </header>
  );
}

function StoryTile({ story, hasBookmark, savedPage, onOpen }) {
  return (
    <button className="story-tile" type="button" onClick={onOpen}>
      <span className="story-thumb-wrap">
        <img className="story-thumb" src={story.coverUrl} alt="" loading="lazy" />
        {hasBookmark && (
          <span className="tile-bookmark" aria-label="Contains a bookmarked page">
            <Icon name="bookmark" size={19} filled />
          </span>
        )}
        {savedPage > 0 && (
          <span className="tile-progress" aria-hidden="true">
            <span style={{ width: `${Math.min(100, savedPage * 10)}%` }} />
          </span>
        )}
      </span>
      <span className="story-tile-title">{story.title}</span>
      <span className="story-tile-theme">{story.theme}</span>
    </button>
  );
}

function Shelf({ stories, bookmarks, progress, onOpenStory, title = "All 10 stories" }) {
  const railRef = useRef(null);
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("All");
  const themes = useMemo(() => ["All", ...new Set(stories.map((story) => story.theme))], [stories]);
  const visibleStories = stories.filter((story) => {
    const matchesTheme = theme === "All" || story.theme === theme;
    const text = `${story.title} ${story.summary} ${story.theme}`.toLocaleLowerCase();
    return matchesTheme && text.includes(search.trim().toLocaleLowerCase());
  });

  function scrollRail() {
    railRef.current?.scrollBy({ left: Math.max(260, railRef.current.clientWidth * 0.72), behavior: "smooth" });
  }

  return (
    <section className="shelf-section" aria-labelledby="shelf-title">
      <div className="shelf-heading-row">
        <h2 id="shelf-title">{title}</h2>
        <label className="story-search">
          <Icon name="search" size={20} />
          <span className="visually-hidden">Search stories</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search stories"
          />
          {search && (
            <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setSearch("")}>
              <Icon name="close" size={17} />
            </button>
          )}
        </label>
      </div>

      <div className="theme-rail" role="group" aria-label="Filter stories by theme">
        {themes.map((item) => (
          <button
            type="button"
            key={item}
            className={`theme-filter ${theme === item ? "is-selected" : ""}`}
            aria-pressed={theme === item}
            onClick={() => setTheme(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {visibleStories.length > 0 ? (
        <div className="story-rail-wrap">
          <div className="story-rail" role="list" ref={railRef}>
            {visibleStories.map((story) => {
              const hasBookmark = bookmarks.some((entry) => entry.storyId === story.id);
              return (
                <div role="listitem" className="story-rail-item" key={story.id}>
                  <StoryTile
                    story={story}
                    hasBookmark={hasBookmark}
                    savedPage={progress.pages?.[story.id] ?? 0}
                    onOpen={() => onOpenStory(story.id, progress.pages?.[story.id] ?? 1)}
                  />
                </div>
              );
            })}
          </div>
          {visibleStories.length > 4 && (
            <button className="rail-next" type="button" onClick={scrollRail} aria-label="Show more stories">
              <Icon name="chevronRight" size={24} />
            </button>
          )}
        </div>
      ) : (
        <p className="empty-shelf">No stories match that search. Try another title or theme.</p>
      )}
    </section>
  );
}

function ReadingTrail({ stories, progress, onContinue }) {
  const latest = progress.latest;
  const story = latest ? stories.find((item) => item.id === latest.storyId) : null;
  const pageNumber = latest?.pageNumber ?? 0;

  return (
    <section className="reading-trail" aria-labelledby="trail-title">
      <div className="reading-trail-inner">
        <h2 id="trail-title">Your reading trail</h2>
        {story ? (
          <div className="trail-row">
            <img src={story.coverUrl} alt="" className="trail-thumb" />
            <div className="trail-info">
              <div className="trail-title-row">
                <span>{story.title}</span>
                <span className="trail-count">Page {pageNumber} of 10</span>
              </div>
              <div
                className="trail-progress-track"
                role="progressbar"
                aria-label={`${story.title} reading progress`}
                aria-valuemin="0"
                aria-valuemax="10"
                aria-valuenow={pageNumber}
              >
                <span style={{ width: `${(pageNumber / 10) * 100}%` }} />
              </div>
            </div>
            <button className="trail-continue" type="button" onClick={onContinue}>
              Continue <Icon name="chevronRight" size={18} />
            </button>
          </div>
        ) : (
          <div className="trail-empty">
            <span>Choose a story to start your trail.</span>
            <span className="trail-empty-leaf" aria-hidden="true">✦</span>
          </div>
        )}
      </div>
    </section>
  );
}

function BookmarkList({ stories, bookmarks, onOpenBookmark, onRemoveBookmark, onShowStories }) {
  if (!bookmarks.length) {
    return (
      <div className="bookmark-empty">
        <span className="empty-bookmark-icon"><Icon name="bookmark" size={30} /></span>
        <p>No pages saved yet.</p>
        <button type="button" className="primary-button compact-button" onClick={onShowStories}>Browse stories</button>
      </div>
    );
  }

  return (
    <div className="bookmark-list">
      {bookmarks.map((entry) => {
        const story = stories.find((item) => item.id === entry.storyId);
        if (!story) return null;
        const page = story.pages[entry.pageNumber - 1];
        return (
          <article className="bookmark-entry" key={entry.key}>
            <button className="bookmark-entry-main" type="button" onClick={() => onOpenBookmark(entry)}>
              <img src={story.coverUrl} alt="" loading="lazy" />
              <span className="bookmark-entry-copy">
                <span className="bookmark-entry-title">{story.title}</span>
                <span className="bookmark-entry-page">Page {entry.pageNumber} of 10 · {story.theme}</span>
                <span className="bookmark-entry-snippet">{page?.text}</span>
              </span>
            </button>
            <button
              className="remove-bookmark"
              type="button"
              aria-label={`Remove bookmark from ${story.title}, page ${entry.pageNumber}`}
              onClick={() => onRemoveBookmark(entry.key)}
            >
              <Icon name="close" size={20} />
            </button>
          </article>
        );
      })}
    </div>
  );
}

export default function Library({
  stories,
  view,
  bookmarks,
  progress,
  onShowStories,
  onShowBookmarks,
  onOpenStory,
  onContinue,
  onOpenBookmark,
  onRemoveBookmark,
}) {
  return (
    <div className="library-view">
      <Header view={view} onShowStories={onShowStories} onShowBookmarks={onShowBookmarks} />
      {view === "bookmarks" ? (
        <main className="library-main bookmarks-page">
          <div className="bookmark-page-heading">
            <h1>Bookmarked pages</h1>
          </div>
          <BookmarkList
            stories={stories}
            bookmarks={bookmarks}
            onOpenBookmark={onOpenBookmark}
            onRemoveBookmark={onRemoveBookmark}
            onShowStories={onShowStories}
          />
        </main>
      ) : (
        <>
          <main>
            <section className="hero-section">
              <div className="hero-copy">
                <h1>Ten little stories<br />of big wonder</h1>
                <p>Choose a cozy adventure and read together.</p>
                <button type="button" className="primary-button" onClick={onContinue}>
                  Start reading <Icon name="arrowRight" size={21} />
                </button>
              </div>
              <div className="hero-art-wrap">
                <img
                  className="hero-art"
                  src="/images/cover.webp"
                  alt="The Lanternberry Path friends gathered along a glowing woodland path."
                  fetchPriority="high"
                />
              </div>
            </section>

            <ReadingTrail stories={stories} progress={progress} onContinue={onContinue} />

            <div className="library-main">
              <Shelf
                stories={stories}
                bookmarks={bookmarks}
                progress={progress}
                onOpenStory={onOpenStory}
              />
            </div>
          </main>
          <footer className="site-footer">
            <Brand />
            <span>Ten Little Stories of Big Wonder · For ages 4–8</span>
          </footer>
        </>
      )}
    </div>
  );
}
