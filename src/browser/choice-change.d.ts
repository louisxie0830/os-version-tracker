// The one event between the components (browser scripts, so global types rather than imports: each compiles
// to a classic script that the page loads with <script defer>).

/** What a <choice-chips> group announces: its name attribute and the chosen chip's data-value */
interface ChoiceChangeDetail {
  name: string;
  value: string;
}

interface HTMLElementEventMap {
  'choice-change': CustomEvent<ChoiceChangeDetail>;
}
