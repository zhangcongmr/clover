import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
// import { XPlace } from '@ng-nest/ui/core';
import { ServiceRouteInfo } from '../model';
import { ConfigService, CoreService, MicroserviceDataStatus } from '../../core.service';

import { FormsModule } from '@angular/forms';
import { AstModalComponent } from '../ast-modal/ast-modal.component';

@Component({
    selector: 'app-service-manager',
    templateUrl: './service-manager.component.html',
    styleUrls: ['./service-manager.component.css'],
    standalone: true,
    imports: [AstModalComponent, FormsModule]
})
export class ServiceManagerComponent implements OnInit {
  private coreService = inject(CoreService);
  private http = inject(HttpClient);

  type!: string;
  addServiceVisible!: boolean;
  deleteServiceVisible!: boolean;
  resetServiceVisible!: boolean;
  // placement!: XPlace;

  data: {
    serviceRoute: ServiceRouteInfo;
  } = { serviceRoute: new ServiceRouteInfo()};

  services: Array<ServiceRouteInfo> = [];

  ngOnInit() {
    // this.coreService.dialogSubject.subscribe((val: any) => {
    //   if (val.action == "open" && val.id == ConfigService.dialogServiceManagerId) {
    //     this.type = val.data.type;
    //     if(val.data.type == ConfigService.addService) {
    //       // this.placement = 'center';
    //       this.addServiceVisible = true;
    //     } else if(val.data.type == ConfigService.deleteService) {
    //       // this.placement = 'center';
    //       this.deleteServiceVisible = true;
    //       this.initService();
    //     } else if(val.data.type == ConfigService.resetService) {
    //       // this.placement = 'center';
    //       this.resetServiceVisible = true;
    //       this.initResetService();
    //     }
    //   }
    // })
  }

  async initService() {
    const services = await this.coreService.getServiceData();
    this.services = services;
  }

  async initResetService() {
    this.services =  await this.coreService.initService();
  }

  async deleteAction(service: ServiceRouteInfo) {
    await this.coreService.deleteServiceFromStorage(service);
    let updateList: Array<ServiceRouteInfo> = [];
    for (const li of this.services) {
      if(li.routeName != service.routeName) {
        updateList.push(li);
      }
    }
    this.services = updateList;
  }

  close() {
    if(this.type == ConfigService.addService) {
      this.addServiceVisible = false;
    }
    if(this.type == ConfigService.deleteService) {
      this.deleteServiceVisible = false;
    }
    if(this.type == ConfigService.resetService) {
      this.resetServiceVisible = false;
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

  async confirm() {
    if(this.type == ConfigService.addService) {
      const serviceRoute: ServiceRouteInfo = {
        namespace: "umebn",
        serviceName: this.data.serviceRoute.serviceName,
        serviceVersion: "v1",
        publishProtocol: "https",
        publishPort: 28001,
        routeType: "api",
        routeName: this.data.serviceRoute.routeName,
        routeVersion: "v1",
        publishUrl: "/api/" + this.data.serviceRoute.routeName + "/v1"
      };
      if(this.data.serviceRoute.publishPort) {
        serviceRoute.publishPort = this.data.serviceRoute.publishPort;
      }
      if(this.data.serviceRoute.publishUrl) {
        serviceRoute.publishUrl = this.data.serviceRoute.publishUrl;
      }
      if(this.data.serviceRoute.specUrl) {
        serviceRoute.specUrl = this.data.serviceRoute.specUrl;
      }
      await this.coreService.setMicroserviceDataToStorage(serviceRoute);
    }
    if(this.type == ConfigService.resetService) {
      await this.coreService.resetMicroserviceDataToStorage(this.services);
    }
    this.close();
  }

  cancel() {
    this.close();
  }
}
