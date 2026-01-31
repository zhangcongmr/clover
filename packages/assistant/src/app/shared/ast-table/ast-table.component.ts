import { Component, OnChanges, OnInit, SimpleChanges, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';


@Component({
    selector: 'ast-table',
    templateUrl: './ast-table.component.html',
    styleUrls: ['./ast-table.component.css'],
    standalone: true,
    imports: [FormsModule]
})
export class AstTableComponent implements OnInit, OnChanges {

  readonly columns = input<Array<any>>([]);
  readonly data = input<Array<any>>([]);
  readonly headerSticky = input(false);
  readonly showNo = input(true)
  readonly showCheckBox = input(true);

  columnArray: Array<any> = []
  dataArray: any = []

  readonly selected = output<any>(); 

  selectedArr: Array<any> = [];

  constructor() { }

  ngOnChanges(changes: SimpleChanges): void {
    if(changes["columns"]) {
      this.columnArray = []
      let cols: Array<any> = []
      //add No.
      if(this.showNo()) {
        cols.push({key: "No.", title: "No."})
      }
      cols = cols.concat(this.columns())
      this.columnArray = cols;
    }

    if (changes["data"]) {
      this.dataArray = []
      for (let index = 0; index < this.data().length; index++) {
        const ele = this.data()[index];
        let dataArr: Array<string> = [];
        //add No.
        if (this.showNo()) {
          dataArr.push(index + "")
        }
        for (let j = 0; j < this.columns().length; j++) {
          const key = this.columns()[j]['key'];
          dataArr.push(ele[key])
        }
        this.dataArray.push(dataArr);
      }
    }
  }

  ngOnInit() {
  }

  clickTableRow(evt: any, i: number) {
    // 阻止点击复选框时触发行点击事件  
    if ((evt.target as HTMLInputElement).type === 'checkbox') {  
      return;  
    }  
    const checkBox = evt.target.parentElement.querySelector("input[type='checkbox']")
    if(checkBox == null) {
      return;
    }
    const checkStatus = checkBox.checked;
    checkBox.checked = !checkStatus;
    this.data()[i].selected = !checkStatus;
    this.dataArray[i].selected = !checkStatus;
    const checkedItems = this.data().filter(item => item.selected);
    this.selected.emit(checkedItems);
  }

  onCheckboxChange(index: number, evt: any) {  
    this.data()[index].selected = evt.target.checked;
    this.dataArray[index].selected = evt.target.checked;
    const checkedItems = this.data().filter(item => item.selected);
    this.selected.emit(checkedItems);
  }

  onAllCheckboxChange(evt: any) {
    const checkStatus = evt.target.checked;
    for (let index = 0; index < this.data().length; index++) {
      this.data()[index].selected = checkStatus;
    }
    for (let index = 0; index < this.dataArray.length; index++) {
      this.dataArray[index].selected = checkStatus;
    }
    const checkedItems = this.data().filter(item => item.selected);
    this.selected.emit(checkedItems);
  }
}
