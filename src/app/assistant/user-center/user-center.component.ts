import { Component, OnInit } from "@angular/core";


@Component({
  selector: 'div[user-center]',
  templateUrl: './user-center.component.html',
  styleUrls: ['./user-center.component.css']
})
export class UserCenterComponent implements OnInit{
  userInfo = {
    username: 'AS773223423',
    phone: '139****5635',
    avatar: '🐻'
  };
  menuItems = [
    { label: '首页', link: '#' },
    { label: '我的内容', link: '#' },
    { label: '我的积分', link: '#' },
    { label: '我的优惠券', link: '#' },
    { label: '我的购物卡', link: '#' },
    { label: '设备管理', link: '#' },
    { label: '账号安全', link: '#' }
  ];

  products = [
    {
      image: '📱',
      name: '旗舰1',
      desc: '骁龙8 Gen3 5G手机',
      price: '¥5999'
    },
    {
      image: '📱',
      name: '旗舰2',
      desc: '第三代骁龙8 8G+256G',
      price: '¥2099'
    },
    {
      image: '💻',
      name: '普通3',
      desc: '省芯超A 大内存',
      price: '¥1899'
    },
    {
      image: '📱',
      name: '家庭1',
      desc: '性能旗舰新选择',
      price: '¥3199'
    },
    {
      image: '💻',
      name: '企业1',
      desc: '骁龙8 Gen3 8G+128G',
      price: '¥2699'
    }
  ];
  statistics = {
    points: 0,
    coupons: 0,
    shoppingCards: 0
  };

  ngOnInit() {
    // 初始化逻辑可以放在这里
    // 例如，从服务器获取用户数据等 curl https://127.0.0.1:8980/user/info/1234
    fetch('https://127.0.0.1:8980/user/info/1234')
      .then(response => response.json())
      .then(data => {
        this.userInfo = data;
        this.statistics = {
          points: data.points,
          coupons: data.coupons,
          shoppingCards: data.shoppingCards
        };
      });
  }

  checkin() {
    alert('签到成功！');
  }


}