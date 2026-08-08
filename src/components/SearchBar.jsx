import React from "react";
import { SearchIcon, CloseIcon } from "./icons";

export default function SearchBar({
  search,
  onSearchChange,
  filteredCount,
  totalCount,
}) {
  return (
    <div className="search-bar-wrapper">
      <div className="search-input-container">
        <SearchIcon size={15} className="search-icon" />
        <input
          className="search-input"
          type="text"
          placeholder="Search clipboard history..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button
            className="btn-search-clear"
            onClick={() => onSearchChange("")}
            title="Clear search"
          >
            <CloseIcon size={13} />
          </button>
        )}
      </div>

      <div className="search-stats">
        <span className="count-badge">
          {filteredCount} / {totalCount} {totalCount === 1 ? "entry" : "entries"}
        </span>
        <span className="shortcut-hint-badge">
          <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>W</kbd> quick paste
        </span>
      </div>
    </div>
  );
}
