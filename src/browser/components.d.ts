// What the components share (browser scripts, so global types rather than imports: each compiles to a classic
// script that the page loads with <script defer>).

/** What a <choice-chips> group announces: its name attribute and the chosen chip's data-value */
interface ChoiceChangeDetail {
  name: string;
  value: string;
}

/** What <activity-filter> reports after each update: how many "now" cards and feed rows match */
interface ActivityFilteredDetail {
  shown: number;
}

/** <page-search> after each search: the sections it left empty (their ids) */
interface PageSearchedDetail {
  missing: string[];
}

interface HTMLElementEventMap {
  'choice-change': CustomEvent<ChoiceChangeDetail>;
  'activity-filtered': CustomEvent<ActivityFilteredDetail>;
  /** A filter changed which of its rows are shown (bubbles) */
  'rows-changed': CustomEvent<void>;
  'page-searched': CustomEvent<PageSearchedDetail>;
}

interface DocumentEventMap {
  'page-searched': CustomEvent<PageSearchedDetail>;
}

/** A <choice-chips> group once its script has run */
interface ChoiceChipsElement extends HTMLElement {
  /** Marks `chip` as the chosen one and announces its value */
  choose(chip: HTMLElement): void;
}

interface HTMLElementTagNameMap {
  'choice-chips': ChoiceChipsElement;
}
