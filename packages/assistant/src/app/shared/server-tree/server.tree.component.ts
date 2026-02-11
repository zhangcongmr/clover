import { Component, OnInit,AfterViewInit, inject, output, viewChild } from '@angular/core';
import { ConfigService, CoreService } from '../../core.service';
import { AstTreeComponent } from '../../shared/ast-tree/ast-tree.component';
import { AuthorizeComponent } from '../authorize/authorize.component';
import { ServerManagerComponent } from '../server-manager/server-manager.component';
import { ServiceManagerComponent } from '../service-manager/service-manager.component';
import { FormsModule } from '@angular/forms';
import { AstMenuComponent } from '../ast-menu/ast-menu.component';
import { TreeNodeType } from '../model';

@Component({
    selector: 'server-tree',
    templateUrl: './server.tree.component.html',
    styleUrls: ['./server.tree.component.css'],
    standalone: true,
    imports: [AstMenuComponent, AstTreeComponent, FormsModule,  AuthorizeComponent, ServerManagerComponent, ServiceManagerComponent]
})
export class ServerTreeComponent implements OnInit, AfterViewInit {
  readonly serverManagerComponent = viewChild(ServerManagerComponent);
  readonly serviceManagerComponent = viewChild(ServiceManagerComponent);
  coreService = inject(CoreService);
  readonly dataOutput = output<Array<any>>();
  readonly rawDataOutput = output<Array<any>>();
  readonly clickRoot = output();
  data = [];

  serverList: Array<any> = [];
  currentServer: any = {};

  authorizeBtnLabel: string = "授权";
  exitAuthorizeLabel: string = "退出";
  shouldAuthorize = false;

  blurSwitch = true;
  isOpen = false;
  menuInitiator: any;

  ngOnInit() {
    this.init()
  }

  async init() {
    const servers = await this.coreService.getServersFromStorage(true);
    servers.map(server => {
      server['nodeType'] = 'folder';
      server.label = server.text
    });
    this.serverList = servers;
  }

  listClick(evt: any) {
    if (evt['nodeType'] != 'file') {
      this.setService(evt);
      this.currentServer = evt;
      this.checkIfShouldAuthorize();
      this.clickRoot.emit(this.currentServer);
      return;
    }

    this.data = []
    // this.data = (index: number, size: number, query: XQuery) => this.clearList(index, size, query).pipe(delay(100));
    let me = this;
    this.currentServer = evt.parentItem;
    // this.currentServer.serviceRoute = evt;
    let specUrl = me.getSpecUrlByServerAndServiceInfo(evt);
    me.coreService.choosingApiLoading = true;
    this.coreService.getData(specUrl).subscribe({
      next: (rawData: any) => {
        me.coreService.choosingApiLoading = false;
        if (!rawData) {
          return;
        }

        const parentItemCopy = JSON.parse(JSON.stringify(evt))
        parentItemCopy["children"] = []

        me.data = this.coreService.parseOpenApiSpec(rawData, me.currentServer, evt.id);
        me.dataOutput.emit(me.data);
        me.rawDataOutput.emit(rawData);
      },
      error: (reason: any) => {
        me.coreService.choosingApiLoading = false;
        if (reason.status == 0) {
          if (specUrl.startsWith("https://")) {
            this.coreService.handlePrivacyError(specUrl);
          }
        }
        if (reason.url.includes("/api/oauth2/v1/authorize?")) {
          // me.coreService.dialogSubject.next({
          //   action: "open",
          //   id: ConfigService.dialogAuthorizeId,
          //   data: {
          //     url: this.currentServer.value + ConfigService.authorizedUrl
          //   }
          // });
        }
      }
    });
  }

  private async checkIfShouldAuthorize() {
    const hasToken = await this.coreService.checkIfHasMatchAccessToken(this.currentServer.value);
    this.shouldAuthorize = !hasToken;
  }

  getSpecUrlByServerAndServiceInfo(evt: any) {
    const scheme = evt.publishProtocol;
    const publishPort = evt.publishPort;
    const serverIp = this.coreService.extractIp(evt.parentItem.value);
    const basePath = scheme + "://" + serverIp + ":" + publishPort;
    if(evt.specUrl) {
      return basePath + evt.specUrl;
    } else {
      return basePath + ConfigService.prefix + evt.routeName + '/' + ConfigService.apiVersion;
    }
  }

  private async setService(server: any) {
    const serviceList = await this.coreService.getServiceData();
    
    const parentItemCopy = JSON.parse(JSON.stringify(server))
    parentItemCopy["children"] = []

    serviceList.forEach((val: any) => {
      val["id"] = val.serviceName;
      val["label"] = val.serviceName;
      val['parentItem'] = parentItemCopy;
      val['nodeType'] ='file';
    });

    if (serviceList && serviceList.length > 0) {
      server.children = serviceList;
    }
  }

  addServerDlg() {
    this.closeMenu()
    const serverManagerComp = this.serverManagerComponent()
    if(serverManagerComp) {
      serverManagerComp.type = ConfigService.addServer;
      serverManagerComp.addServerVisible = true;
    }
  }

  deleteServerDlg() {
    this.closeMenu()
    const serverManagerComp = this.serverManagerComponent()
    if(serverManagerComp) {
      serverManagerComp.type = ConfigService.deleteServer;
      serverManagerComp.deleteServerVisible = true;
    }
  }

  addServiceDlg() {
    this.closeMenu()
    const serviceManagerComp = this.serviceManagerComponent()
    if(serviceManagerComp) {
      serviceManagerComp.type = ConfigService.addService;
      serviceManagerComp.addServiceVisible = true;
    }
  }

  deleteServiceDlg() {
    this.closeMenu()
    const serviceManagerComp = this.serviceManagerComponent()
    if(serviceManagerComp) {
      serviceManagerComp.type = ConfigService.deleteService;
      serviceManagerComp.deleteServiceVisible = true;
    }
  }

  resetServiceDlg() {
    this.closeMenu()
    const serviceManagerComp = this.serviceManagerComponent()
    if(serviceManagerComp) {
      serviceManagerComp.type = ConfigService.resetService;
      serviceManagerComp.resetServiceVisible = true;
    }
  }

  confirmAuthorize(server: any) {
    if (!server.data.userName || !server.data.passwd) {
      return;
    }
    let me = this;
    this.coreService.doAuthorize(this.coreService.getAuthorizeUrl(server), server.data, (result: number) => {
      if (result == 0) {
      }
      if (result == 1) {
        this.shouldAuthorize = false;
        // this.coreService.dialogSubject.next({
        //   action: "open",
        //   id: ConfigService.dialogTipId
        // })
      }
    });
  }

  clearAuthorize(server: any) {
    this.closeMenu()
    this.coreService.clearAuthorize(server.value, (result: number) => {
      if (result == 0) {
      }
      if (result == 1) {
        this.shouldAuthorize = true;
      }
    });
  }

  closeMenu() {
    this.blurSwitch = true;
    this.isOpen = false;
  }

  clickMoreBtn(evt: any) {
    if (!this.isOpen) {
      this.isOpen = !this.isOpen;
      this.menuInitiator = evt.target.getBoundingClientRect();
    }
  }

  blurMoreBtn(evt: any) {
    let me = this;
      if (me.blurSwitch) {
        me.isOpen = false;
      }
  }

  mouseentermenu(evt: any) {
    this.blurSwitch = false;
  }

  mouseleavemenu(evt: any) {
    this.blurSwitch = true;
  }

  ngAfterViewInit(): void {

  }
}
