import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { ConfigService, CoreService } from '../../core.service';

import { FormsModule } from '@angular/forms';
import { AstModalComponent } from '../ast-modal/ast-modal.component';
import { AstSelectComponent } from '../ast-select/ast-select.component';

@Component({
    selector: 'app-server-manager',
    templateUrl: './server-manager.component.html',
    styleUrls: ['./server-manager.component.css'],
    standalone: true,
    imports: [AstModalComponent, FormsModule, AstSelectComponent]
})
export class ServerManagerComponent implements OnInit {
  private coreService = inject(CoreService);
  private http = inject(HttpClient);

  type!: string;
  addServerVisible!: boolean;
  deleteServerVisible!: boolean;

  data: {
    scheme: string;
    ip: string;
    port: string;
  } = { scheme: 'https', ip: '', port: '' };

  servers: Array<any> = [];

  dataList = [
    {
      value: 'https'
    },
    {
      value: 'http'
    },
    {
      value: 'wss'
    }
  ]

  ngOnInit() {
    // this.coreService.dialogSubject.subscribe((val: any) => {
    //   if (val.action == "open" && val.id == ConfigService.dialogServerManagerId) {
    //     this.type = val.data.type;
    //     if(val.data.type == ConfigService.addServer) {
    //       // this.placement = 'center';
    //       this.addServerVisible = true;
    //     } else if(val.data.type == ConfigService.deleteServer) {
    //       // this.placement = 'center';
    //       this.deleteServerVisible = true;
    //       this.initServer();
    //     }
    //   }
    // })
  }

  visibleChangeDeleteDlg(evt: any) {
    if(evt == true) {
      this.initServer();
    }
  }

  async initServer() {
    const servers = await this.coreService.getServersFromStorage(false);
    this.servers = servers;
  }

  async deleteAction(server: any) {
    await this.coreService.deleteServerFromStorage(server.value);
    let updateList: Array<any> = [];
    for (const li of this.servers) {
      if(li.value != server.value) {
        updateList.push(li);
      }
    }
    this.servers = updateList;
  }

  close() {
    if(this.type == ConfigService.addServer) {
      this.addServerVisible = false;
    }
    if(this.type == ConfigService.deleteServer) {
      this.deleteServerVisible = false;
    }
  }

  beforeClose = () => {
    // this.msgBox.confirm({
    //   title: '提示',
    //   content: '有未保存的数据，确认关闭吗？',
    //   type: 'warning',
    //   callback: (action: XMessageBoxAction) => {
    //     action === 'confirm' && this.close();
    //   }
    // });
    this.close();
  };

  confirm() {
    if(this.type == ConfigService.addServer) {
      this.coreService.setServerToStorage(this.data);
    }
    this.close();
  }

  cancel() {
    this.close();
  }
}
