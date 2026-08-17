import {Component, ContentChildren, Directive, Input, QueryList} from '@angular/core';


@Directive({
    selector: 'pane',
    standalone: true
})
export class Pane {
  @Input() id!: string;
}

@Component({
    selector: 'tab',
    template: `
    <div class="top-level">Top level panes: {{serializedPanes}}</div>
    <div class="nested">Arbitrary nested panes: {{serializedNestedPanes}}</div>
  `,
    standalone: true
})
export class Tab {
  @ContentChildren(Pane) topLevelPanes!: QueryList<Pane>;
  @ContentChildren(Pane, {descendants: true}) arbitraryNestedPanes!: QueryList<Pane>;

  get serializedPanes(): string {
    return this.topLevelPanes ? this.topLevelPanes.map(p => p.id).join(', ') : '';
  }
  get serializedNestedPanes(): string {
    return this.arbitraryNestedPanes ? this.arbitraryNestedPanes.map(p => p.id).join(', ') : '';
  }
}

@Component({
    selector: 'example-app',
    template: `
    <tab>
      <pane id="1" style="width:200px;height:100px;border:2px solid;background:yellow;"></pane>
      <pane id="2" style="width:200px;height:100px;border:2px solid;background:red;"></pane>
      @if (shouldShow) {
        <pane id="3">
          <tab>
            <pane id="3_1" style="width:200px;height:100px;border:2px solid;background:blue;"></pane>
            <pane id="3_2" style="width:200px;height:100px;border:2px solid;background:yellow;"></pane>
          </tab>
        </pane>
      }
    </tab>
    
    <button (click)="show()">Show 3</button>
    `,
    standalone: true,
    imports: [
    Tab,
    Pane
],
})
export class ContentChildrenComp {
  shouldShow = false;

  show() {
    this.shouldShow = true;
  }
}