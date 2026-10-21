import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_URL = window.location.port === '8100' ? 'http://localhost:3000' : '';

export interface Bus {
  id: number;
  nom_ligne: string;
  num_ligne: string;
  num_bus?: string | null;
  latitude: number;
  longitude: number;
  vitesse: number;
  etat: 'marche' | 'arret' | 'panne' | 'transfert' | 'school' | 'plein';
  ordre_actuel: number;
}

@Injectable({ providedIn: 'root' })
export class ArretService {
  constructor(private http: HttpClient) {}

  getBus(): Observable<Bus[]> {
    return this.http.get<Bus[]>(`${API_URL}/bus`);
  }
  updateEtat(id: number, etat: string): Observable<Bus> {
    return this.http.put<Bus>(`${API_URL}/bus/${id}/etat`, { etat });
  }
  updatePosition(busId: number, ordre: number): Observable<Bus> {
    return this.http.put<Bus>(`${API_URL}/bus/${busId}/position`, { ordre });
  }
  getArrets(): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/arrets`);
  }
  getTrajets(): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/trajets`);
  }
  getLignes(): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/lignes`);
  }
  getCheminLigne(numLigne: string): Observable<any> {
    return this.http.get<any>(`${API_URL}/ligne/${numLigne}/chemin`);
  }
  chercherTrajet(fromId: number, toId: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/trajet?fromId=${fromId}&toId=${toId}`);
  }
  ajouterRetour(busId: number, arretId: number, statut: string, etaPrevue: number | null): Observable<any> {
    return this.http.post(`${API_URL}/retours`, { busId, arretId, statut, etaPrevue });
  }
  envoyerSignalement(data: {
    numLigne: string;
    arretId: number;
    numBus: string;
    etat: string;
    latitude: number | null;
    longitude: number | null;
  }): Observable<any> {
    return this.http.post(`${API_URL}/signalements`, data);
  }
  getZones(): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/zones`);
  }
  getZonesGeojson(): Observable<any> {
    return this.http.get<any>(`${API_URL}/zones/geojson`);
  }
  localiserZone(lat: number, lon: number): Observable<any> {
    return this.http.get<any>(`${API_URL}/zones/localiser?lat=${lat}&lon=${lon}`);
  }
  getArretsZone(zoneId: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/zones/${zoneId}/arrets`);
  }
  getBusPresents(zoneId: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_URL}/zones/${zoneId}/bus/presents`);
  }
  itineraire(zoneId: number, toId: number, lat: number | null, lon: number | null): Observable<any[]> {
    let url = `${API_URL}/itineraire?zoneId=${zoneId}&toId=${toId}`;
    if (lat !== null && lon !== null) url += `&lat=${lat}&lon=${lon}`;
    return this.http.get<any[]>(url);
  }
  arretLePlusProche(arrets: any[], lat: number, lon: number) {
    const rad = Math.PI / 180;
    let meilleur: { arret: any; km: number } | null = null;
    for (const a of arrets) {
      const dLat = (a.latitude - lat) * rad;
      const dLon = (a.longitude - lon) * rad;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat * rad) * Math.cos(a.latitude * rad) * Math.sin(dLon / 2) ** 2;
      const km = 2 * 6371 * Math.asin(Math.sqrt(h));
      if (!meilleur || km < meilleur.km) meilleur = { arret: a, km };
    }
    return meilleur;
  }
}