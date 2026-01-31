import { Component, Input, OnChanges, OnInit, SimpleChanges, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';


@Component({
    selector: 'ast-select',
    templateUrl: './ast-select.component.html',
    styleUrls: ['./ast-select.component.css'],
    standalone: true,
    imports: [FormsModule]
})
export class AstSelectComponent implements OnInit, OnChanges {
  readonly selected = output<any>();
  readonly focus = output<any>();
  readonly blur = output<any>();
  readonly opened = output<any>();

  data = input<Array<{
    value: string;
    displayName?: string;
    selected?: boolean;
    color?: string;
  }>>([]);

  @Input() inputValue: any;
  readonly width = input<string>("6rem");
  readonly readonly = input<boolean>(false);

  selectedOption: any;
  dataBackUp: any = []; // to backup original data

// 用于存储计算出的宽度和位置
  dropdownWidth: number = 0;
  dropdownLeft: number = 0;
  dropdownTop: number = 0;

  displayItems: Array<{
    value: string;
    displayName?: string;
    selected?: boolean;
    color?: string;
  }> = [];

  constructor() { }

  ngOnChanges(changes: SimpleChanges): void {
    // throw new Error('Method not implemented.');

    if(changes["data"]) {
      const data = this.data()
      if(data) {
        this.displayItems = data.map((item: any) => {
          const displayItem = {...item}
          if(!item["displayName"]) {
            displayItem["displayName"] = item["value"];
          }
          return displayItem;
        })
        const dataStr = JSON.stringify(this.displayItems);
        if(dataStr) {
          this.dataBackUp = JSON.parse(dataStr);
        }
        if(this.displayItems.length > 0 && !this.inputValue) {
          const selectedItem = this.displayItems.filter((item: any) => item["selected"]);
          if(selectedItem.length > 0) {
            this.selectedOption = selectedItem[0];
            return;
          }
          this.selectedOption = this.displayItems[0];
        }
      }
    }
    if(changes["inputValue"]) {
      if(this.inputValue) {
        const selectedItem = this.displayItems.filter((item: any) => item["value"] == this.inputValue);
        if(selectedItem.length > 0) {
          this.selectedOption = selectedItem[0];
        } else {
          this.selectedOption = {}
        }
      }
    }
  }

  ngOnInit() {
  }

  currentTarget: any;
  selectContentArea: any;
  isOpen = false;
  clickSelectInput(evt: any) {
    this.currentTarget = evt.currentTarget;
    this.selectContentArea = evt.currentTarget.parentElement.parentElement.children[0];
    if(!this.isOpen) {
      this.selectContentArea.style.display = "flex";
      this.displayItems = this.dataBackUp;
      this.isOpen = !this.isOpen;

      const target = evt.currentTarget.parentElement;
      const rect = target.getBoundingClientRect();
      this.dropdownLeft = rect.left;
      this.dropdownTop = rect.bottom + 4;
      this.dropdownWidth = rect.width;
    }
  }

  blurSwitch = true;
  whenBlur(evt: any) {
    if(this.blurSwitch) {
      if(this.selectContentArea) {
        this.selectContentArea.style.display = "none";
        this.isOpen = false;
      }
    }
  }

  enterSelectArea(evt: any) {
    this.blurSwitch = false;
  }

  leaveSelectArea(evt: any) {
    this.blurSwitch = true;
  }

  selectedItem(evt: any, item: any) {
    this.blurSwitch = true;
    if(this.selectContentArea) {
      this.selectContentArea.style.display = "none";
      this.isOpen = false;
      this.selectedOption = item;
      this.selected.emit(item);
    }
  }

  lastInput: any;
  keyUpSearch(evt: any) {
    this.search();
  }

  pasteSearch(evt: any) {
    this.search();
  }

  cutSearch(evt: any) {
    this.search();
  }

  private search() {
    clearTimeout(this.lastInput);
    let searchResults: any = [];
    this.lastInput = setTimeout(() => {
      console.log("searchValue is: " + this.inputValue);
      if (this.inputValue.length > 0) {
        for (let index = 0; index < this.dataBackUp.length; index++) {
          const element = this.dataBackUp[index];
          if (element["displayName"].toLocaleLowerCase().includes(this.inputValue.toLocaleLowerCase())) {
            searchResults.push(element);
          }
        }
        this.displayItems = searchResults;
      } else {
        this.displayItems = this.dataBackUp;
      }
    }, 200);
  }

}
