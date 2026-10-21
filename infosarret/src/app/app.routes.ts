import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'carte',
        loadComponent: () => import('./pages/recherche/recherche.page').then((m) => m.RecherchePage),
      },
      {
        path: 'signaler',
        loadComponent: () => import('./pages/signaler/signaler.page').then((m) => m.SignalerPage),
      },
      { path: '', redirectTo: 'carte', pathMatch: 'full' },
    ],
  },
  {
    path: 'admin/bus',
    loadComponent: () => import('./pages/bus-list/bus-list.page').then((m) => m.BusListPage),
  },
];